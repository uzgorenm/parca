"""Event schema and partitioned append-only log (mini Kafka)."""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class EventType(str, Enum):
    ORDER_PLACED = "order_placed"
    ORDER_CANCELLED = "order_cancelled"
    TRADE_EXECUTED = "trade_executed"
    PRICE_UPDATE = "price_update"
    PORTFOLIO_CHANGED = "portfolio_changed"
    WINDOW_SUMMARY = "window_summary"


@dataclass(frozen=True, slots=True)
class Event:
    id: str
    timestamp: float
    topic: str
    property_id: str
    type: EventType
    payload: dict[str, Any]

    @classmethod
    def create(
        cls,
        topic: str,
        property_id: str,
        event_type: EventType,
        payload: dict[str, Any],
    ) -> Event:
        return cls(
            id=uuid.uuid4().hex,
            timestamp=time.time(),
            topic=topic,
            property_id=property_id,
            type=event_type,
            payload=payload,
        )


# ---------------------------------------------------------------------------
# Partitioned ring-buffer log
# ---------------------------------------------------------------------------

@dataclass
class Partition:
    """Append-only ring buffer for a single property_id."""

    property_id: str
    capacity: int = 10_000
    _buffer: list[Event | None] = field(default_factory=list, repr=False)
    _write_offset: int = 0  # total events ever written (monotonic)
    _notify: asyncio.Event = field(default_factory=asyncio.Event, repr=False)

    def __post_init__(self) -> None:
        self._buffer = [None] * self.capacity

    @property
    def head_offset(self) -> int:
        """Earliest offset still available in the ring buffer."""
        if self._write_offset <= self.capacity:
            return 0
        return self._write_offset - self.capacity

    @property
    def tail_offset(self) -> int:
        """Next offset to be written (one past the last event)."""
        return self._write_offset

    def append(self, event: Event) -> int:
        idx = self._write_offset % self.capacity
        self._buffer[idx] = event
        offset = self._write_offset
        self._write_offset += 1
        self._notify.set()
        self._notify = asyncio.Event()  # reset for next waiter
        return offset

    def read(self, offset: int) -> Event | None:
        if offset < self.head_offset or offset >= self._write_offset:
            return None
        return self._buffer[offset % self.capacity]

    def read_batch(self, offset: int, max_count: int = 100) -> list[Event]:
        events: list[Event] = []
        start = max(offset, self.head_offset)
        end = min(start + max_count, self._write_offset)
        for i in range(start, end):
            ev = self._buffer[i % self.capacity]
            if ev is not None:
                events.append(ev)
        return events

    async def wait_for_new(self, current_offset: int, timeout: float = 1.0) -> bool:
        """Wait until new data is available past current_offset."""
        if current_offset < self._write_offset:
            return True
        try:
            await asyncio.wait_for(self._notify.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False


class EventLog:
    """Partitioned event log — one partition per property_id."""

    def __init__(self, partition_capacity: int = 10_000) -> None:
        self._partitions: dict[str, Partition] = {}
        self._partition_capacity = partition_capacity
        self._global_subscribers: list[asyncio.Queue[Event]] = []

    def get_or_create_partition(self, property_id: str) -> Partition:
        if property_id not in self._partitions:
            self._partitions[property_id] = Partition(
                property_id=property_id,
                capacity=self._partition_capacity,
            )
        return self._partitions[property_id]

    def append(self, event: Event) -> int:
        partition = self.get_or_create_partition(event.property_id)
        offset = partition.append(event)
        # Fan-out to global subscribers (non-blocking)
        for q in self._global_subscribers:
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                pass  # subscriber is slow — drop
        return offset

    def subscribe_global(self, maxsize: int = 1000) -> asyncio.Queue[Event]:
        q: asyncio.Queue[Event] = asyncio.Queue(maxsize=maxsize)
        self._global_subscribers.append(q)
        return q

    def unsubscribe_global(self, q: asyncio.Queue[Event]) -> None:
        self._global_subscribers.remove(q)

    @property
    def partitions(self) -> dict[str, Partition]:
        return self._partitions
