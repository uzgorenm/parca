"""Processing layer — order matcher, windowed aggregator, portfolio updater."""

from __future__ import annotations

import asyncio
import time
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any

from events import Event, EventLog, EventType


# ---------------------------------------------------------------------------
# Order Matcher — one per partition (single-threaded per property)
# ---------------------------------------------------------------------------

@dataclass(order=True)
class OrderEntry:
    price: float
    timestamp: float  # tie-break: earlier orders first
    order_id: str = field(compare=False)
    user_id: str = field(compare=False)
    quantity: int = field(compare=False)


@dataclass
class OrderBook:
    """In-memory order book for a single property. Sorted bids (desc) / asks (asc)."""

    property_id: str
    bids: list[OrderEntry] = field(default_factory=list)  # buy orders, highest first
    asks: list[OrderEntry] = field(default_factory=list)  # sell orders, lowest first

    def add_bid(self, entry: OrderEntry) -> None:
        # Insert maintaining descending price order
        import bisect
        # Negate price for descending sort with bisect
        key = (-entry.price, entry.timestamp)
        idx = bisect.bisect_left(
            [(- b.price, b.timestamp) for b in self.bids], key
        )
        self.bids.insert(idx, entry)

    def add_ask(self, entry: OrderEntry) -> None:
        import bisect
        key = (entry.price, entry.timestamp)
        idx = bisect.bisect_left(
            [(a.price, a.timestamp) for a in self.asks], key
        )
        self.asks.insert(idx, entry)


class OrderMatcher:
    """
    Reads order_placed events from the log for assigned partitions,
    maintains order books, and emits trade_executed events on match.

    Single-threaded per partition — no locking needed.
    Multiple partitions run as separate coroutines for parallelism.
    """

    def __init__(self, event_log: EventLog) -> None:
        self.event_log = event_log
        self._books: dict[str, OrderBook] = {}
        self._offsets: dict[str, int] = {}  # consumer offset per partition
        self._tasks: list[asyncio.Task[None]] = []
        self._running = False

    def _get_book(self, property_id: str) -> OrderBook:
        if property_id not in self._books:
            self._books[property_id] = OrderBook(property_id=property_id)
        return self._books[property_id]

    async def start(self) -> None:
        self._running = True
        # Monitor for new partitions
        self._tasks.append(asyncio.create_task(self._partition_watcher()))

    async def stop(self) -> None:
        self._running = False
        for t in self._tasks:
            t.cancel()
        await asyncio.gather(*self._tasks, return_exceptions=True)
        self._tasks.clear()

    async def _partition_watcher(self) -> None:
        """Watch for new partitions and spawn a consumer for each."""
        seen: set[str] = set()
        try:
            while self._running:
                current = set(self.event_log.partitions.keys())
                new = current - seen
                for pid in new:
                    self._tasks.append(
                        asyncio.create_task(self._consume_partition(pid))
                    )
                seen = current
                await asyncio.sleep(0.1)
        except asyncio.CancelledError:
            pass

    async def _consume_partition(self, property_id: str) -> None:
        """Consume events from a single partition."""
        partition = self.event_log.get_or_create_partition(property_id)
        offset = self._offsets.get(property_id, partition.head_offset)

        try:
            while self._running:
                await partition.wait_for_new(offset, timeout=0.5)
                events = partition.read_batch(offset, max_count=50)
                for event in events:
                    if event.type == EventType.ORDER_PLACED:
                        self._process_order(event)
                    offset += 1
                self._offsets[property_id] = offset
        except asyncio.CancelledError:
            pass

    def _process_order(self, event: Event) -> None:
        payload = event.payload
        side = payload["side"]  # "buy" or "sell"
        book = self._get_book(event.property_id)

        entry = OrderEntry(
            price=payload["price"],
            timestamp=event.timestamp,
            order_id=event.id,
            user_id=payload["user_id"],
            quantity=payload["quantity"],
        )

        if side == "buy":
            book.add_bid(entry)
        else:
            book.add_ask(entry)

        # Try to match
        self._match(book, event.property_id)

    def _match(self, book: OrderBook, property_id: str) -> None:
        """Match crossing orders and emit trade_executed events."""
        while book.bids and book.asks:
            best_bid = book.bids[0]
            best_ask = book.asks[0]

            if best_bid.price < best_ask.price:
                break  # no match

            # Match at the ask price (price-time priority)
            trade_qty = min(best_bid.quantity, best_ask.quantity)
            trade_price = best_ask.price

            trade_event = Event.create(
                topic="trades",
                property_id=property_id,
                event_type=EventType.TRADE_EXECUTED,
                payload={
                    "buyer_id": best_bid.user_id,
                    "seller_id": best_ask.user_id,
                    "buy_order_id": best_bid.order_id,
                    "sell_order_id": best_ask.order_id,
                    "price": trade_price,
                    "quantity": trade_qty,
                },
            )
            self.event_log.append(trade_event)

            # Update remaining quantities
            best_bid.quantity -= trade_qty
            best_ask.quantity -= trade_qty

            if best_bid.quantity == 0:
                book.bids.pop(0)
            if best_ask.quantity == 0:
                book.asks.pop(0)


# ---------------------------------------------------------------------------
# Windowed Aggregator — sliding/tumbling windows per property
# ---------------------------------------------------------------------------

@dataclass
class WindowBucket:
    window_start: float
    window_end: float
    property_id: str
    total_volume: int = 0
    total_value: float = 0.0
    trade_count: int = 0

    @property
    def avg_price(self) -> float:
        return self.total_value / self.total_volume if self.total_volume > 0 else 0.0

    def add_trade(self, price: float, quantity: int) -> None:
        self.total_volume += quantity
        self.total_value += price * quantity
        self.trade_count += 1


class WindowedAggregator:
    """
    Tumbling windows of configurable durations.
    On each incoming trade, checks if window has expired, flushes summary, starts new.
    """

    # Window durations in seconds
    WINDOW_DURATIONS = [60, 300, 3600]  # 1-min, 5-min, 1-hour

    def __init__(self, event_log: EventLog) -> None:
        self.event_log = event_log
        # Key: (property_id, duration) -> WindowBucket
        self._windows: dict[tuple[str, int], WindowBucket] = {}
        self._subscription: asyncio.Queue[Event] | None = None
        self._task: asyncio.Task[None] | None = None
        self._running = False

    async def start(self) -> None:
        self._running = True
        self._subscription = self.event_log.subscribe_global(maxsize=5000)
        self._task = asyncio.create_task(self._consume())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self._subscription:
            self.event_log.unsubscribe_global(self._subscription)

    async def _consume(self) -> None:
        assert self._subscription is not None
        try:
            while self._running:
                try:
                    event = await asyncio.wait_for(self._subscription.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    # Check for expired windows even without new events
                    self._flush_expired()
                    continue

                if event.type == EventType.TRADE_EXECUTED:
                    self._process_trade(event)
        except asyncio.CancelledError:
            # Flush all open windows on shutdown
            self._flush_all()

    def _process_trade(self, event: Event) -> None:
        now = event.timestamp
        price = event.payload["price"]
        quantity = event.payload["quantity"]

        for duration in self.WINDOW_DURATIONS:
            key = (event.property_id, duration)
            bucket = self._windows.get(key)

            if bucket is not None and now >= bucket.window_end:
                # Window expired — flush and start new
                self._emit_summary(bucket, duration)
                bucket = None

            if bucket is None:
                window_start = now - (now % duration)  # align to boundary
                bucket = WindowBucket(
                    window_start=window_start,
                    window_end=window_start + duration,
                    property_id=event.property_id,
                )
                self._windows[key] = bucket

            bucket.add_trade(price, quantity)

    def _flush_expired(self) -> None:
        now = time.time()
        expired_keys = [
            k for k, b in self._windows.items() if now >= b.window_end
        ]
        for key in expired_keys:
            bucket = self._windows.pop(key)
            self._emit_summary(bucket, key[1])

    def _flush_all(self) -> None:
        for key, bucket in list(self._windows.items()):
            self._emit_summary(bucket, key[1])
        self._windows.clear()

    def _emit_summary(self, bucket: WindowBucket, duration: int) -> None:
        if bucket.trade_count == 0:
            return
        summary = Event.create(
            topic="aggregations",
            property_id=bucket.property_id,
            event_type=EventType.WINDOW_SUMMARY,
            payload={
                "window_start": bucket.window_start,
                "window_end": bucket.window_end,
                "duration_seconds": duration,
                "total_volume": bucket.total_volume,
                "avg_price": bucket.avg_price,
                "trade_count": bucket.trade_count,
            },
        )
        self.event_log.append(summary)


# ---------------------------------------------------------------------------
# Portfolio Updater — listens to trades, updates holdings
# ---------------------------------------------------------------------------

@dataclass
class Holding:
    property_id: str
    quantity: int = 0
    avg_cost: float = 0.0


class PortfolioUpdater:
    """
    Listens to trade_executed events and updates user portfolios.
    Emits portfolio_changed events downstream.
    """

    def __init__(self, event_log: EventLog) -> None:
        self.event_log = event_log
        # user_id -> property_id -> Holding
        self._portfolios: dict[str, dict[str, Holding]] = defaultdict(dict)
        self._subscription: asyncio.Queue[Event] | None = None
        self._task: asyncio.Task[None] | None = None
        self._running = False

    def get_portfolio(self, user_id: str) -> dict[str, Holding]:
        return dict(self._portfolios.get(user_id, {}))

    async def start(self) -> None:
        self._running = True
        self._subscription = self.event_log.subscribe_global(maxsize=5000)
        self._task = asyncio.create_task(self._consume())

    async def stop(self) -> None:
        self._running = False
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
        if self._subscription:
            self.event_log.unsubscribe_global(self._subscription)

    async def _consume(self) -> None:
        assert self._subscription is not None
        try:
            while self._running:
                try:
                    event = await asyncio.wait_for(self._subscription.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    continue
                if event.type == EventType.TRADE_EXECUTED:
                    self._process_trade(event)
        except asyncio.CancelledError:
            pass

    def _process_trade(self, event: Event) -> None:
        payload = event.payload
        buyer_id = payload["buyer_id"]
        seller_id = payload["seller_id"]
        property_id = event.property_id
        price = payload["price"]
        quantity = payload["quantity"]

        # Update buyer holding
        self._update_holding(buyer_id, property_id, quantity, price)
        self._emit_portfolio_changed(buyer_id, property_id, event)

        # Update seller holding
        self._update_holding(seller_id, property_id, -quantity, price)
        self._emit_portfolio_changed(seller_id, property_id, event)

    def _update_holding(
        self, user_id: str, property_id: str, qty_delta: int, price: float
    ) -> None:
        holdings = self._portfolios[user_id]
        if property_id not in holdings:
            holdings[property_id] = Holding(property_id=property_id)

        h = holdings[property_id]
        if qty_delta > 0:
            # Buying — update weighted average cost
            total_cost = h.avg_cost * h.quantity + price * qty_delta
            h.quantity += qty_delta
            h.avg_cost = total_cost / h.quantity if h.quantity > 0 else 0.0
        else:
            # Selling — just reduce quantity
            h.quantity += qty_delta  # qty_delta is negative
            if h.quantity <= 0:
                h.quantity = 0
                h.avg_cost = 0.0

    def _emit_portfolio_changed(
        self, user_id: str, property_id: str, trigger: Event
    ) -> None:
        holding = self._portfolios[user_id].get(property_id)
        self.event_log.append(
            Event.create(
                topic="portfolios",
                property_id=property_id,
                event_type=EventType.PORTFOLIO_CHANGED,
                payload={
                    "user_id": user_id,
                    "property_id": property_id,
                    "quantity": holding.quantity if holding else 0,
                    "avg_cost": holding.avg_cost if holding else 0.0,
                    "trigger_trade_id": trigger.id,
                },
            )
        )
