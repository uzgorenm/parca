# Parça

> **Archived development simulation.** This prototype uses simulated cash, positions, orders, returns, and distributions. It does not accept money, execute securities transactions, or convey legal ownership.

This branch preserves an early real-time property-market simulation. Its Python `asyncio` backend uses only `aiohttp` and implements a small Kafka-style event log with partitioned storage, consumer offsets, backpressure, order matching, windowed aggregation, and WebSocket delivery.

## Architecture

The backend is organized into three layers that mirror a production streaming pipeline:

```
Producers (HTTP)
      │
      ▼
┌─────────────┐     ┌──────────────────────────────────────────┐
│  Ingestion   │────▶│            Event Log (mini Kafka)         │
│  Layer       │     │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │
│              │     │  │ prop-001│ │ prop-002│ │ prop-N  │   │
│  Bounded     │     │  │ Ring Buf│ │ Ring Buf│ │ Ring Buf│   │
│  Queues +    │     │  └─────────┘ └─────────┘ └─────────┘   │
│  Backpressure│     └──────────┬───────────────┬──────────────┘
└─────────────┘                │               │
                    ┌──────────┴───┐   ┌───────┴──────────┐
                    │ Partition     │   │ Global            │
                    │ Consumers     │   │ Subscribers       │
                    │              │   │                   │
                    │ Order Matcher│   │ Windowed Aggregator│
                    │ (per-partition│   │ Portfolio Updater  │
                    │  coroutine)  │   │ Delivery Layer     │
                    └──────────────┘   └───────────────────┘
                                              │
                                              ▼
                                       ┌──────────────┐
                                       │  WebSocket    │
                                       │  Fan-out      │
                                       │  to Clients   │
                                       └──────────────┘
```

### Layer 1: Ingestion (`ingestion.py`)

Accepts events from producers via an async HTTP API. Each event gets a UUID, timestamp, topic tag, and is routed to a partition by `propertyId`.

**Backpressure mechanism:** Each partition has a bounded `asyncio.Queue` (default capacity: 1,000). The producer gets one of three responses:

| Status | Condition | HTTP Code | Meaning |
|---|---|---|---|
| `ok` | Queue < 80% full | 200 | Accepted normally |
| `backpressure` | Queue 80-99% full | 200 | Accepted, but slow down |
| `rejected` | Queue 100% full | 429 | Dropped — retry later |

A dedicated drain worker per partition moves events from the bounded queue into the event log. This decouples ingestion speed from processing speed — producers never block on downstream consumers.

### Layer 2: Processing (`processors.py`)

Three independent async workers consume from the event log at their own pace:

**Order Matcher** — The core concurrency challenge. Reads `order_placed` events and maintains an in-memory order book (sorted bids descending, asks ascending) per property. When a buy price meets or exceeds a sell price, it executes a trade at the ask price (price-time priority) and emits a `trade_executed` event back into the log.

The concurrency model follows Kafka's design: **one consumer coroutine per partition, multiple partitions in parallel**. Since each property's orders are processed by a single coroutine, there is no locking needed within a partition. A partition watcher dynamically spawns new consumer coroutines as new properties appear.

**Windowed Aggregator** — Maintains tumbling windows at 1-minute, 5-minute, and 1-hour intervals per property. On each incoming trade event, it checks if the current window has expired. If so, it flushes a `window_summary` event containing total volume, average price, and trade count, then starts a new window. Windows are aligned to clock boundaries (e.g., the 1-minute window for 12:03:47 starts at 12:03:00). Even without incoming events, expired windows are flushed on a 500ms timeout check.

**Portfolio Updater** — Listens to `trade_executed` events and updates user holdings in memory. Tracks quantity and weighted average cost per (user, property) pair. Emits `portfolio_changed` events for both the buyer and seller of every trade, which flow downstream to WebSocket delivery.

### Layer 3: Delivery (`delivery.py`)

Connected WebSocket clients subscribe by user ID, property IDs, or topics. The delivery layer consumes the global event stream and routes each event to matching clients:

- `trade_executed` → the buyer, the seller, and anyone watching that property
- `portfolio_changed` → the user whose portfolio changed
- `window_summary` → anyone watching that property
- `price_update` → anyone watching that property

Fan-out is concurrent — all matching clients receive the event in parallel via `asyncio.gather`. Dead clients are automatically unregistered on send failure.

## Event Log Design (`events.py`)

The event log is a from-scratch mini Kafka. Key concepts:

**Uniform event schema:** Every event in the system shares the same shape:
```python
{
    "id": "a1b2c3...",         # UUID
    "timestamp": 1711504200.0,  # Unix epoch
    "topic": "orders",          # Logical stream name
    "propertyId": "prop-001",   # Partition key
    "type": "order_placed",     # Event type enum
    "payload": { ... }          # Type-specific data
}
```

**Partitioned ring buffer:** Each `propertyId` gets its own `Partition` — a fixed-size ring buffer (default 10,000 events). Old events are overwritten when the buffer wraps. This bounds memory usage regardless of throughput. In production, this is where you'd add a write-ahead log (WAL) to disk before overwriting.

**Consumer offsets:** Each consumer tracks a monotonically increasing offset per partition. Consumers can read at their own pace — a slow consumer falls behind but doesn't block others. If a consumer falls more than `capacity` events behind, it loses data (same as Kafka retention).

**Async notification:** `Partition.wait_for_new()` uses `asyncio.Event` to let consumers sleep until new data arrives rather than polling. This gives sub-millisecond wake-up latency without busy loops.

**Global subscribers:** In addition to per-partition consumption, the `EventLog` supports global subscriber queues. When an event is appended to any partition, it's also pushed (non-blocking) to all global subscriber queues. Slow subscribers get dropped events rather than blocking the writer. This is used by the aggregator, portfolio updater, and delivery layer, which need to see events across all partitions.

## Design Decisions

**Why single-threaded per partition?** The order matcher is the critical concurrency challenge — multiple orders arriving simultaneously for the same property must be processed in sequence to maintain order book consistency. Rather than using locks (which are error-prone and limit throughput), we follow Kafka's model: partition the data by property, assign one coroutine per partition, and run partitions in parallel. This gives us lock-free correctness within a partition and parallelism across properties.

**Why ring buffers instead of unbounded lists?** Unbounded growth is the #1 cause of OOM in event-driven systems. Ring buffers cap memory at `O(partitions × capacity)` regardless of how long the system runs. The trade-off is that old events are lost — acceptable for a prototype, and exactly where you'd add disk persistence in production.

**Why bounded queues for backpressure?** Without backpressure, a burst of producer traffic can consume unbounded memory in internal buffers and eventually crash the process. Bounded `asyncio.Queue` provides a natural flow control point — when full, the producer gets an immediate rejection signal rather than silently queuing indefinitely.

**Why global subscriber queues?** The order matcher reads per-partition (it only cares about orders for a specific property), but the aggregator and portfolio updater need cross-partition visibility. Rather than having each processor poll every partition, the event log pushes to subscriber queues at write time. This is a fan-out-on-write pattern — one write fans out to N subscribers with O(1) work per subscriber.

**Why `asyncio` over threads or multiprocessing?** The workload is I/O-bound (network, WebSockets) with short CPU bursts (order matching). `asyncio` gives us cooperative concurrency on a single thread, eliminating race conditions and context-switch overhead. The per-partition coroutine model maps naturally to asyncio tasks.

**Why match at the ask price?** This is standard price-time priority matching. When a buy order crosses a sell order, the trade executes at the ask (sell) price because the seller posted their price first. The buyer is getting a better deal than they asked for.

## API Reference

### HTTP Endpoints

**`POST /api/orders`** — Place a buy or sell order.
```json
{
    "propertyId": "prop-001",
    "side": "buy",
    "price": 100.50,
    "quantity": 10,
    "userId": "alice"
}
```
Response:
```json
{
    "status": "ok",
    "eventId": "a1b2c3d4...",
    "message": "Accepted"
}
```

**`POST /api/events`** — Generic event ingestion.
```json
{
    "topic": "orders",
    "propertyId": "prop-001",
    "type": "order_placed",
    "payload": { "side": "buy", "price": 100.50, "quantity": 10, "user_id": "alice" }
}
```

**`GET /api/orderbook/{property_id}`** — View the current order book.
```json
{
    "propertyId": "prop-001",
    "bids": [{ "price": 100.50, "quantity": 10, "orderId": "..." }],
    "asks": [{ "price": 101.00, "quantity": 5, "orderId": "..." }]
}
```

**`GET /api/portfolio/{user_id}`** — View a user's holdings.
```json
{
    "userId": "alice",
    "holdings": {
        "prop-001": { "quantity": 10, "avgCost": 99.50 }
    }
}
```

**`GET /api/stats`** — System statistics.
```json
{
    "partitions": 3,
    "totalEvents": 1542,
    "connectedClients": 7,
    "orderBooks": 3
}
```

### WebSocket (`GET /ws`)

Connect and send a subscribe message:
```json
{ "action": "subscribe", "userId": "alice", "propertyIds": ["prop-001"], "topics": ["trades"] }
```

The server pushes matching events as JSON:
```json
{
    "id": "...",
    "timestamp": 1711504200.0,
    "topic": "trades",
    "propertyId": "prop-001",
    "type": "trade_executed",
    "payload": {
        "buyer_id": "alice",
        "seller_id": "bob",
        "price": 99.0,
        "quantity": 5
    }
}
```

## Running Locally

### Prerequisites

- Python 3.11+

### Setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Start the server

```bash
cd backend
source .venv/bin/activate
python server.py
```

The server starts on `http://localhost:8080`. All layers (ingestion, order matching, aggregation, portfolio tracking, WebSocket delivery) start automatically.

### Run the integration tests

```bash
cd backend
source .venv/bin/activate
python test_pipeline.py
```

This exercises the full pipeline without HTTP — it places crossing orders, verifies trade execution, checks portfolio updates, order book state, and backpressure behavior.

### Quick smoke test with curl

```bash
# Place a buy order
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"propertyId": "prop-001", "side": "buy", "price": 100, "quantity": 10, "userId": "alice"}'

# Place a crossing sell order (triggers a trade)
curl -X POST http://localhost:8080/api/orders \
  -H "Content-Type: application/json" \
  -d '{"propertyId": "prop-001", "side": "sell", "price": 99, "quantity": 5, "userId": "bob"}'

# Check the order book (buy order should have 5 remaining)
curl http://localhost:8080/api/orderbook/prop-001

# Check Alice's portfolio (should own 5 shares)
curl http://localhost:8080/api/portfolio/alice

# Check system stats
curl http://localhost:8080/api/stats
```

### Test WebSocket delivery

Using `websocat` or any WebSocket client:

```bash
# Connect and subscribe
websocat ws://localhost:8080/ws

# Send this JSON to subscribe:
{"action": "subscribe", "userId": "alice", "propertyIds": ["prop-001"], "topics": ["trades"]}

# Now place orders via curl in another terminal — you'll see trade events pushed here
```

## File Structure

```
backend/
├── events.py          # Event schema, partitioned ring-buffer log
├── ingestion.py       # Bounded queues, backpressure, drain workers
├── processors.py      # Order matcher, windowed aggregator, portfolio updater
├── delivery.py        # WebSocket fan-out with subscription routing
├── server.py          # HTTP API, WebSocket handler, lifecycle wiring
├── test_pipeline.py   # Integration test (no HTTP needed)
└── requirements.txt   # aiohttp
```

## Production Considerations

This is a prototype. For production, you would add:

- **Write-ahead log (WAL):** Persist events to disk before the ring buffer overwrites them, enabling crash recovery and replay.
- **Persistent order books:** Snapshot order book state periodically so it can be rebuilt on restart without replaying the entire log.
- **Authentication and authorization:** The HTTP and WebSocket endpoints are currently unauthenticated.
- **Rate limiting:** Beyond backpressure, per-user and per-IP rate limits at the API gateway layer.
- **Horizontal scaling:** Partition assignment across multiple processes/nodes (like Kafka consumer groups). The per-partition single-coroutine model maps directly to this.
- **Observability:** Prometheus metrics for queue depths, match latency, event throughput per partition. Structured logging with correlation IDs.
- **Order types:** Limit orders, market orders, stop-loss, time-in-force (GTC/IOC/FOK).
