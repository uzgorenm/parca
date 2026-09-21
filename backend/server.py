"""Main server — HTTP API + WebSocket delivery, wires all layers together."""

from __future__ import annotations

import json
import logging

from aiohttp import web

from events import EventLog, EventType
from ingestion import IngestionLayer
from processors import OrderMatcher, WindowedAggregator, PortfolioUpdater
from delivery import DeliveryLayer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application state — created at startup, shared across handlers
# ---------------------------------------------------------------------------

class AppState:
    def __init__(self) -> None:
        self.event_log = EventLog(partition_capacity=10_000)
        self.ingestion = IngestionLayer(event_log=self.event_log, max_queue_size=1000)
        self.order_matcher = OrderMatcher(event_log=self.event_log)
        self.aggregator = WindowedAggregator(event_log=self.event_log)
        self.portfolio = PortfolioUpdater(event_log=self.event_log)
        self.delivery = DeliveryLayer(event_log=self.event_log)

    async def start(self) -> None:
        await self.ingestion.start()
        await self.order_matcher.start()
        await self.aggregator.start()
        await self.portfolio.start()
        await self.delivery.start()
        logger.info("All layers started")

    async def stop(self) -> None:
        await self.delivery.stop()
        await self.portfolio.stop()
        await self.aggregator.stop()
        await self.order_matcher.stop()
        await self.ingestion.stop()
        logger.info("All layers stopped")


# ---------------------------------------------------------------------------
# HTTP Handlers
# ---------------------------------------------------------------------------

async def handle_ingest(request: web.Request) -> web.Response:
    """
    POST /api/events
    Body: { "topic": str, "propertyId": str, "type": str, "payload": {...} }
    """
    state: AppState = request.app["state"]

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    topic = body.get("topic", "orders")
    property_id = body.get("propertyId")
    event_type_str = body.get("type")
    payload = body.get("payload", {})

    if not property_id:
        return web.json_response({"error": "propertyId required"}, status=400)

    try:
        event_type = EventType(event_type_str)
    except (ValueError, KeyError):
        return web.json_response(
            {"error": f"Invalid event type: {event_type_str}"},
            status=400,
        )

    result = await state.ingestion.ingest(
        topic=topic,
        property_id=property_id,
        event_type=event_type,
        payload=payload,
    )

    status_code = 200 if result.status.value != "rejected" else 429
    return web.json_response(
        {
            "status": result.status.value,
            "eventId": result.event_id,
            "message": result.message,
        },
        status=status_code,
    )


async def handle_order(request: web.Request) -> web.Response:
    """
    POST /api/orders
    Convenience endpoint that wraps order_placed ingestion.
    Body: { "propertyId": str, "side": "buy"|"sell", "price": float,
            "quantity": int, "userId": str }
    """
    state: AppState = request.app["state"]

    try:
        body = await request.json()
    except json.JSONDecodeError:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    required = ["propertyId", "side", "price", "quantity", "userId"]
    missing = [f for f in required if f not in body]
    if missing:
        return web.json_response(
            {"error": f"Missing fields: {missing}"}, status=400
        )

    if body["side"] not in ("buy", "sell"):
        return web.json_response({"error": "side must be 'buy' or 'sell'"}, status=400)

    result = await state.ingestion.ingest(
        topic="orders",
        property_id=body["propertyId"],
        event_type=EventType.ORDER_PLACED,
        payload={
            "side": body["side"],
            "price": float(body["price"]),
            "quantity": int(body["quantity"]),
            "user_id": body["userId"],
        },
    )

    status_code = 200 if result.status.value != "rejected" else 429
    return web.json_response(
        {
            "status": result.status.value,
            "eventId": result.event_id,
            "message": result.message,
        },
        status=status_code,
    )


async def handle_portfolio(request: web.Request) -> web.Response:
    """GET /api/portfolio/{user_id}"""
    state: AppState = request.app["state"]
    user_id = request.match_info["user_id"]
    holdings = state.portfolio.get_portfolio(user_id)
    return web.json_response({
        "userId": user_id,
        "holdings": {
            pid: {"quantity": h.quantity, "avgCost": h.avg_cost}
            for pid, h in holdings.items()
        },
    })


async def handle_orderbook(request: web.Request) -> web.Response:
    """GET /api/orderbook/{property_id}"""
    state: AppState = request.app["state"]
    property_id = request.match_info["property_id"]
    book = state.order_matcher._books.get(property_id)
    if not book:
        return web.json_response({"bids": [], "asks": []})
    return web.json_response({
        "propertyId": property_id,
        "bids": [
            {"price": b.price, "quantity": b.quantity, "orderId": b.order_id}
            for b in book.bids
        ],
        "asks": [
            {"price": a.price, "quantity": a.quantity, "orderId": a.order_id}
            for a in book.asks
        ],
    })


async def handle_stats(request: web.Request) -> web.Response:
    """GET /api/stats — overall system stats."""
    state: AppState = request.app["state"]
    partitions = state.event_log.partitions
    return web.json_response({
        "partitions": len(partitions),
        "totalEvents": sum(p.tail_offset for p in partitions.values()),
        "connectedClients": state.delivery.client_count,
        "orderBooks": len(state.order_matcher._books),
    })


# ---------------------------------------------------------------------------
# WebSocket handler
# ---------------------------------------------------------------------------

async def handle_ws(request: web.Request) -> web.WebSocketResponse:
    """
    GET /ws
    Client sends JSON to subscribe:
      { "action": "subscribe", "userId": "u1", "propertyIds": ["p1"], "topics": ["trades"] }
    Server pushes matching events as JSON.
    """
    state: AppState = request.app["state"]
    ws = web.WebSocketResponse()
    await ws.prepare(request)

    sub = None
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                try:
                    data = json.loads(msg.data)
                except json.JSONDecodeError:
                    await ws.send_str(json.dumps({"error": "Invalid JSON"}))
                    continue

                action = data.get("action")
                if action == "subscribe":
                    # Unregister previous subscription if any
                    if sub:
                        state.delivery.unregister_client(sub)

                    sub = state.delivery.register_client(
                        websocket=ws,
                        user_id=data.get("userId"),
                        property_ids=set(data.get("propertyIds", [])),
                        topics=set(data.get("topics", [])),
                    )
                    await ws.send_str(json.dumps({"status": "subscribed"}))
                else:
                    await ws.send_str(json.dumps({"error": f"Unknown action: {action}"}))

            elif msg.type in (web.WSMsgType.ERROR, web.WSMsgType.CLOSE):
                break
    finally:
        if sub:
            state.delivery.unregister_client(sub)

    return ws


# ---------------------------------------------------------------------------
# App factory and lifecycle
# ---------------------------------------------------------------------------

async def on_startup(app: web.Application) -> None:
    state = AppState()
    app["state"] = state
    await state.start()


async def on_shutdown(app: web.Application) -> None:
    state: AppState = app["state"]
    await state.stop()


def create_app() -> web.Application:
    app = web.Application()

    app.on_startup.append(on_startup)
    app.on_shutdown.append(on_shutdown)

    app.router.add_post("/api/events", handle_ingest)
    app.router.add_post("/api/orders", handle_order)
    app.router.add_get("/api/portfolio/{user_id}", handle_portfolio)
    app.router.add_get("/api/orderbook/{property_id}", handle_orderbook)
    app.router.add_get("/api/stats", handle_stats)
    app.router.add_get("/ws", handle_ws)

    return app


if __name__ == "__main__":
    web.run_app(create_app(), host="0.0.0.0", port=8080)
