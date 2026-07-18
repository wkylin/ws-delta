import assert from "node:assert/strict";
import test from "node:test";
import { decideSend } from "../server/src/engine/backpressure";
import { GatewayMetrics, PrometheusExporter } from "../server/src/engine/metrics";

const limits = { bufferedAmountHighWaterBytes: 100, bufferedAmountCloseBytes: 200 };

test("backpressure keeps structural frames and drops recoverable frames", () => {
  assert.equal(decideSend(99, 1, true, limits), "drop_recoverable");
  assert.equal(decideSend(99, 1, false, limits), "send");
  assert.equal(decideSend(199, 1, true, limits), "close_slow_consumer");
  assert.equal(decideSend(0, 99, true, limits), "send");
});

test("prometheus exporter renders gateway and runtime metrics", async () => {
  const metrics = new GatewayMetrics();
  metrics.connectionOpened();
  metrics.inbound(12);
  metrics.outbound("ready", 40);
  const output = await new PrometheusExporter().render(metrics.snapshot(1, 1, [8]));
  assert.match(output, /ws_realtime_connections 1/);
  assert.match(output, /ws_realtime_inbound_bytes_total 12/);
  assert.match(output, /ws_realtime_outbound_messages_by_type_total\{type="ready"\} 1/);
});
