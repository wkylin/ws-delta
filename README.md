# ws-realtime

A standalone, full-stack WebSocket reference project extracted from the sports application. It pairs a Vue odds board with the structured realtime mock server and demonstrates high-frequency odds updates without coupling the example to the original stores, router, i18n layer, or API clients.

## What is included

- Vue 3 + Vite odds board derived from the production `OddsBoard.vue` information architecture.
- Complete copied mock server under `server/src`, including snapshots, collection deltas, outcome deltas, sequence gaps, range tracking, and backpressure controls.
- A small realtime client that owns subscription lifecycle, reconnect, topic switching, sequence validation, resync, row registration, and outcome patching.
- A protocol inspector showing message type, sequence, payload size, traffic totals, odds patches, and gaps.
- The original production component at `reference/OddsBoard.original.vue` for comparison. It is intentionally excluded from compilation because it depends on the parent application's stores and shared UI.

## Requirements

- Node.js 22 or newer
- pnpm 10 or newer

## Run

```bash
pnpm install
pnpm dev
```

Open `http://localhost:5180`. The mock server listens on `http://localhost:8088` and upgrades WebSocket connections at:

```text
ws://localhost:8088/gateway/ws/stream
```

Individual processes are also available:

```bash
pnpm dev:server
pnpm dev:frontend
```

## Verify

```bash
pnpm typecheck
pnpm build
curl http://127.0.0.1:8088/health
```

## Message model

The client uses one ordered sequence per topic and stream:

```text
subscribe
  -> topic_snapshot  baseline rows and collection order
  -> outcome_delta   frequent odds/status patches
  -> topic_delta     infrequent membership/order/event changes
  -> resync          requested when a sequence gap is detected
```

Outcome identity is canonical and never inferred from labels:

```text
eventId + sourceMarketKey + sourceOutcomeCode
```

Intermediate odds values are applied in batches by the browser render loop. Collection operations and outcome changes remain separate so a fast price stream does not force full-row replacement.

## Performance profile

The included mock intentionally runs two independent schedules:

- Odds mutations: every `120ms`
- Collection/status mutations: every `6000ms`

This makes the board useful for testing high-frequency rendering while keeping structural churn readable. Production services should use event-driven aggregation rather than random timers.

The default capacity profile allows 16 MiB messages and applies backpressure at 64 MiB of buffered output. Those values are safety ceilings, not target payload sizes. Normal `outcome_delta` packets should stay well below 64 KiB.

## Configuration

Copy `.env.example` to `.env` when overrides are needed. Common settings:

```env
VITE_WS_URL=ws://127.0.0.1:8088/gateway/ws/stream
MOCK_REALTIME_PORT=8088
MOCK_REALTIME_REQUIRE_HELLO=false
MOCK_REALTIME_MAX_SERVER_MESSAGE_BYTES=16777216
```

The demo deliberately uses an unauthenticated local WebSocket. Production credentials must only be sent over `wss://`.

## Layout

```text
ws-realtime/
├── frontend/
│   └── src/
│       ├── App.vue             protocol workbench shell
│       ├── OddsBoard.vue       standalone board UI
│       ├── realtime.ts         WebSocket runtime and merge logic
│       └── types.ts
├── server/
│   └── src/                    complete structured mock backend
├── reference/
│   └── OddsBoard.original.vue  source component from the parent app
└── scripts/dev.mjs             starts frontend and backend together
```

## Backend control endpoints

```text
GET  /health
GET  /api/mock/realtime/state
POST /api/mock/realtime/controls/seq-gap
POST /api/mock/realtime/controls/backpressure
POST /api/mock/realtime/emit/outcome-batch
POST /api/mock/realtime/emit/topic-mixed
```

These endpoints are intended for integration tests and manual failure drills.
