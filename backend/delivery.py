"""Delivery layer — WebSocket fan-out to subscribed clients."""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field

from events import Event, EventLog, EventType

logger = logging.getLogger(__name__)


@dataclass
class ClientSubscription:
    """A connected WebSocket client and what they're subscribed to."""

    websocket: object  # aiohttp.web.WebSocketResponse
    user_id: str | None = None
    property_ids: set[str] = field(default_factory=set)
    topics: set[str] = field(default_factory=set)


def _serialize_event(event: Event) -> str:
    return json.dumps({
        "id": event.id,
        "timestamp": event.timestamp,
        "topic": event.topic,
        "propertyId": event.property_id,
        "type": event.type.value,
        "payload": event.payload,
    })


class DeliveryLayer:
    """
    Subscribes to the global event stream and fans out events to
    connected WebSocket clients based on their subscriptions.

    Fan-out rules:
    - TRADE_EXECUTED -> buyer, seller, and anyone watching the property
    - PORTFOLIO_CHANGED -> the user whose portfolio changed
    - WINDOW_SUMMARY -> anyone watching the property
    - PRICE_UPDATE -> anyone watching the property
    """

    def __init__(self, event_log: EventLog) -> None:
        self.event_log = event_log
        self._clients: list[ClientSubscription] = []
        self._subscription: asyncio.Queue[Event] | None = None
        self._task: asyncio.Task[None] | None = None
        self._running = False

    @property
    def client_count(self) -> int:
        return len(self._clients)

    def register_client(
        self,
        websocket: object,
        user_id: str | None = None,
        property_ids: set[str] | None = None,
        topics: set[str] | None = None,
    ) -> ClientSubscription:
        sub = ClientSubscription(
            websocket=websocket,
            user_id=user_id,
            property_ids=property_ids or set(),
            topics=topics or set(),
        )
        self._clients.append(sub)
        return sub

    def unregister_client(self, sub: ClientSubscription) -> None:
        if sub in self._clients:
            self._clients.remove(sub)

    async def start(self) -> None:
        self._running = True
        self._subscription = self.event_log.subscribe_global(maxsize=5000)
        self._task = asyncio.create_task(self._fanout_loop())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self._subscription:
            self.event_log.unsubscribe_global(self._subscription)

    async def _fanout_loop(self) -> None:
        assert self._subscription is not None
        try:
            while self._running:
                try:
                    event = await asyncio.wait_for(self._subscription.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                await self._deliver(event)
        except asyncio.CancelledError:
            pass

    async def _deliver(self, event: Event) -> None:
        msg = _serialize_event(event)
        targets = self._resolve_targets(event)

        # Send to all targets concurrently
        send_tasks = []
        for client in targets:
            send_tasks.append(self._send_to_client(client, msg))
        if send_tasks:
            await asyncio.gather(*send_tasks, return_exceptions=True)

    def _resolve_targets(self, event: Event) -> list[ClientSubscription]:
        targets: list[ClientSubscription] = []

        for client in self._clients:
            # Topic-based match
            if client.topics and event.topic in client.topics:
                targets.append(client)
                continue

            # Property-based match
            if client.property_ids and event.property_id in client.property_ids:
                targets.append(client)
                continue

            # User-based match for portfolio events
            if event.type == EventType.PORTFOLIO_CHANGED:
                if (
                    client.user_id
                    and event.payload.get("user_id") == client.user_id
                ):
                    targets.append(client)
                    continue

            # Trade events go to buyer and seller
            if event.type == EventType.TRADE_EXECUTED:
                if client.user_id and client.user_id in (
                    event.payload.get("buyer_id"),
                    event.payload.get("seller_id"),
                ):
                    targets.append(client)
                    continue

        return targets

    async def _send_to_client(self, client: ClientSubscription, msg: str) -> None:
        try:
            ws = client.websocket
            # aiohttp WebSocketResponse
            if hasattr(ws, "send_str"):
                await ws.send_str(msg)  # type: ignore[union-attr]
        except Exception:
            logger.debug("Failed to send to client, removing", exc_info=True)
            self.unregister_client(client)
