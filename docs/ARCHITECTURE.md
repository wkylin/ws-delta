# Architecture

## Ownership

```text
MockRealtimeEngine
  produces protocol messages
         |
         v
browser WebSocket transport
         |
         v
realtime.ts
  sequence gate -> row registry -> outcome patch index
         |                              |
         +---------------+--------------+
                         v
                    OddsBoard.vue
```

The transport never imports UI code. The board never parses protocol messages. `realtime.ts` is the boundary that turns ordered protocol data into stable UI rows.

## High-frequency path

1. The backend receives or generates raw odds changes.
2. Changes are grouped by subscribed topic and restricted to tracked event IDs.
3. `outcome_delta` carries only changed outcomes.
4. The client validates `streamId + seq` before applying a message.
5. Outcomes are matched by `eventId + sourceMarketKey + sourceOutcomeCode`.
6. Vue receives one array invalidation after the batch, not one component update per field.

The row registry keeps an `eventId -> row` map and the outcome patch index keeps a composite-key map. Structural changes rebuild both indexes; high-frequency outcome updates do not scan the rendered row collection.

## Low-frequency path

`topic_delta.ops` owns collection membership, ordering, metadata, and event status. Full rows are accepted only as seeds for newly inserted or previously unknown events. Odds-only changes do not replace collections.

## Recovery

A sequence gap makes the current delta unsafe. The client records the gap, does not apply the out-of-order message, and sends `resync` for the active topic. The following `topic_snapshot` becomes the new baseline.

## Backpressure

The mock server tracks `ws.bufferedAmount`:

- Above the high-water mark, recoverable deltas are dropped and a backpressure message is emitted.
- At the hard limit, the slow consumer is disconnected.
- The client reconnects and obtains a fresh snapshot.

In production, intermediate prices for the same outcome should be coalesced to the latest value before serialization. Structural messages should not be silently dropped; loss of structural continuity requires resync.

## Production checklist

- Use `wss://` for every authenticated connection.
- Allocate sequence numbers from one ordered dispatcher per `streamId + topicKey`.
- Serialize a shared topic batch once, then fan it out to matching connections.
- Keep normal packets below 64 KiB even when the safety ceiling is larger.
- Track message rate, bytes, coalescing ratio, queue latency, buffered bytes, sequence gaps, and resync count.
- Keep visible live odds below 250ms end-to-end p95.

The mock gateway exposes the implemented subset through `/health` and Prometheus-style `/metrics`. `pnpm test` covers protocol recovery, stable outcome identity, and backpressure boundaries; `pnpm benchmark` provides a repeatable lookup comparison.
