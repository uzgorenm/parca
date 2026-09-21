"""Ingestion layer — accepts events from producers with backpressure."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from enum import Enum
from typing import Any

from events import Event, EventLog, EventType


class IngestStatus(str, Enum):
    OK = "ok"
    BACKPRESSURE = "backpressure"
    REJECTED = "rejected"


@dataclass
class IngestResult:
    status: IngestStatus
    event_id: str | None = None
    offset: int | None = None
    message: str = ""


@dataclass
class IngestionLayer:
    """
    Bounded async queue per partition that drains into the EventLog.
    Producers never block — they get immediate backpressure feedback.
    """

    event_log: EventLog
    max_queue_size: int = 1000
    _queues: dict[str, asyncio.Queue[Event]] = field(default_factory=dict, repr=False)
    _workers: dict[str, asyncio.Task[None]] = field(default_factory=dict, repr=False)
    _running: bool = False

    def _get_queue(self, property_id: str) -> asyncio.Queue[Event]:
        if property_id not in self._queues:
            q: asyncio.Queue[Event] = asyncio.Queue(maxsize=self.max_queue_size)
            self._queues[property_id] = q
            # Spin up a drain worker for this partition
            if self._running:
                self._workers[property_id] = asyncio.create_task(
                    self._drain(property_id, q)
                )
        return self._queues[property_id]

    async def start(self) -> None:
        self._running = True
        for pid, q in self._queues.items():
            if pid not in self._workers:
                self._workers[pid] = asyncio.create_task(self._drain(pid, q))

    async def stop(self) -> None:
        self._running = False
        for task in self._workers.values():
            task.cancel()
        await asyncio.gather(*self._workers.values(), return_exceptions=True)
        self._workers.clear()

    async def ingest(
        self,
        topic: str,
        property_id: str,
        event_type: EventType,
        payload: dict[str, Any],
    ) -> IngestResult:
        event = Event.create(
            topic=topic,
            property_id=property_id,
            event_type=event_type,
            payload=payload,
        )

        q = self._get_queue(property_id)

        # Non-blocking enqueue with backpressure feedback
        if q.full():
            # Queue is at capacity — check if there's room after a tiny yield
            if q.qsize() >= self.max_queue_size:
                return IngestResult(
                    status=IngestStatus.REJECTED,
                    event_id=event.id,
                    message=f"Partition {property_id} buffer full — slow down",
                )

        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            return IngestResult(
                status=IngestStatus.REJECTED,
                event_id=event.id,
                message=f"Partition {property_id} buffer full — slow down",
            )

        # Signal backpressure when queue is >80% full
        high_water = int(self.max_queue_size * 0.8)
        status = IngestStatus.BACKPRESSURE if q.qsize() > high_water else IngestStatus.OK

        return IngestResult(
            status=status,
            event_id=event.id,
            message="Accepted — consider slowing down" if status == IngestStatus.BACKPRESSURE else "Accepted",
        )

    async def _drain(self, property_id: str, q: asyncio.Queue[Event]) -> None:
        """Worker that drains the bounded queue into the event log."""
        try:
            while self._running:
                event = await q.get()
                self.event_log.append(event)
                q.task_done()
        except asyncio.CancelledError:
            # Drain remaining events on shutdown
            while not q.empty():
                try:
                    event = q.get_nowait()
                    self.event_log.append(event)
                except asyncio.QueueEmpty:
                    break
