"""Integration test — exercises the full pipeline without HTTP."""

import asyncio
import time

from events import EventLog, EventType, Event
from ingestion import IngestionLayer, IngestStatus
from processors import OrderMatcher, WindowedAggregator, PortfolioUpdater


async def test_full_pipeline() -> None:
    log = EventLog(partition_capacity=1000)
    ingestion = IngestionLayer(event_log=log, max_queue_size=100)
    matcher = OrderMatcher(event_log=log)
    aggregator = WindowedAggregator(event_log=log)
    portfolio = PortfolioUpdater(event_log=log)

    # Collect trade events via global subscription
    trade_queue = log.subscribe_global(maxsize=100)

    await ingestion.start()
    await matcher.start()
    await aggregator.start()
    await portfolio.start()

    prop = "prop-001"

    # Place a buy order
    r1 = await ingestion.ingest(
        topic="orders",
        property_id=prop,
        event_type=EventType.ORDER_PLACED,
        payload={"side": "buy", "price": 100.0, "quantity": 10, "user_id": "alice"},
    )
    assert r1.status == IngestStatus.OK, f"Expected OK, got {r1.status}"
    print(f"[OK] Buy order ingested: {r1.event_id}")

    # Place a sell order that crosses
    r2 = await ingestion.ingest(
        topic="orders",
        property_id=prop,
        event_type=EventType.ORDER_PLACED,
        payload={"side": "sell", "price": 99.0, "quantity": 5, "user_id": "bob"},
    )
    assert r2.status == IngestStatus.OK, f"Expected OK, got {r2.status}"
    print(f"[OK] Sell order ingested: {r2.event_id}")

    # Give processors time to consume
    await asyncio.sleep(0.5)

    # Check that a trade was executed
    trades_found = []
    while not trade_queue.empty():
        ev = trade_queue.get_nowait()
        if ev.type == EventType.TRADE_EXECUTED:
            trades_found.append(ev)

    assert len(trades_found) >= 1, f"Expected >=1 trade, got {len(trades_found)}"
    trade = trades_found[0]
    assert trade.payload["buyer_id"] == "alice"
    assert trade.payload["seller_id"] == "bob"
    assert trade.payload["price"] == 99.0  # matched at ask price
    assert trade.payload["quantity"] == 5
    print(f"[OK] Trade executed: {trade.payload}")

    # Check portfolios
    await asyncio.sleep(0.2)
    alice_holdings = portfolio.get_portfolio("alice")
    bob_holdings = portfolio.get_portfolio("bob")
    assert prop in alice_holdings, "Alice should have holdings"
    assert alice_holdings[prop].quantity == 5, f"Alice qty: {alice_holdings[prop].quantity}"
    print(f"[OK] Alice portfolio: qty={alice_holdings[prop].quantity}, avg_cost={alice_holdings[prop].avg_cost}")
    print(f"[OK] Bob portfolio: qty={bob_holdings.get(prop, 'none')}")

    # Check order book — buy order should have 5 remaining
    book = matcher._books.get(prop)
    assert book is not None
    assert len(book.bids) == 1
    assert book.bids[0].quantity == 5  # 10 - 5 filled
    assert len(book.asks) == 0  # sell fully filled
    print(f"[OK] Order book: {len(book.bids)} bids, {len(book.asks)} asks")

    # Test backpressure — flood the queue
    print("\n--- Backpressure test ---")
    bp_count = 0
    reject_count = 0
    for i in range(200):
        r = await ingestion.ingest(
            topic="orders",
            property_id="prop-flood",
            event_type=EventType.ORDER_PLACED,
            payload={"side": "buy", "price": 50.0 + i, "quantity": 1, "user_id": "flood"},
        )
        if r.status == IngestStatus.BACKPRESSURE:
            bp_count += 1
        elif r.status == IngestStatus.REJECTED:
            reject_count += 1
    print(f"[OK] Backpressure signals: {bp_count}, Rejections: {reject_count}")

    # Check partition stats
    partitions = log.partitions
    total_events = sum(p.tail_offset for p in partitions.values())
    print(f"\n--- Stats ---")
    print(f"Partitions: {len(partitions)}")
    print(f"Total events in log: {total_events}")

    # Shutdown
    await portfolio.stop()
    await aggregator.stop()
    await matcher.stop()
    await ingestion.stop()
    log.unsubscribe_global(trade_queue)

    print("\n✓ All tests passed!")


if __name__ == "__main__":
    asyncio.run(test_full_pipeline())
