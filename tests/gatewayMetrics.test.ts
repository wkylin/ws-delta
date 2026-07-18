import assert from "node:assert/strict";
import test from "node:test";
import { parsePrometheusText } from "../frontend/src/gatewayMetrics";

test("parses Prometheus samples, labels, comments, and timestamps", () => {
  const samples = parsePrometheusText(`
# HELP ws_realtime_connections Current connections
ws_realtime_connections 3
ws_realtime_outbound_messages_by_type_total{type="outcome_delta"} 42 1710000000
ws_realtime_invalid NaN
  `);

  assert.deepEqual(samples, [
    { name: "ws_realtime_connections", labels: {}, value: 3 },
    {
      name: "ws_realtime_outbound_messages_by_type_total",
      labels: { type: "outcome_delta" },
      value: 42,
    },
  ]);
});
