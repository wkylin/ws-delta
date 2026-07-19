import assert from "node:assert/strict";
import test from "node:test";
import {
  recordInbound,
  recordOutbound,
  startTelemetrySession,
  wsFrames,
  wsTelemetryState,
  wsTopicMetrics,
  wsTypeMetrics,
} from "../frontend/src/wsTelemetry";

test("records real inbound and outbound message dimensions", () => {
  startTelemetrySession(false);

  const subscription = {
    type: "subscribe",
    items: [
      { topic: "home.top_matches", moduleType: "TOP_MATCHES" },
      { topic: "live.multi.pc", moduleType: "LIVE_MULTI_VIEW" },
    ],
  };
  recordOutbound(subscription, JSON.stringify(subscription));

  for (const type of ["topic_snapshot", "topic_delta", "outcome_delta"]) {
    recordInbound(JSON.stringify({
      type,
      item: { topic: "live.multi.pc" },
      seq: 12,
      traceId: `trace-${type}`,
    }));
  }

  assert.equal(wsTelemetryState.outbound, 1);
  assert.equal(wsTelemetryState.inbound, 3);
  assert.equal(wsFrames.length, 4);
  assert.deepEqual(
    wsTypeMetrics.value.map((metric) => metric.type).sort(),
    ["outcome_delta", "subscribe", "topic_delta", "topic_snapshot"],
  );

  const liveTopic = wsTopicMetrics.value.find((metric) => metric.topic === "live.multi.pc");
  assert.ok(liveTopic);
  assert.equal(liveTopic.inbound, 3);
  assert.equal(liveTopic.outbound, 1);
  assert.equal(liveTopic.total, 4);
  assert.equal(liveTopic.lastSeq, 12);

  const homeTopic = wsTopicMetrics.value.find((metric) => metric.topic === "home.top_matches");
  assert.ok(homeTopic);
  assert.equal(homeTopic.outbound, 1);
});

test("starts a clean telemetry session after reconnect", () => {
  startTelemetrySession(false);
  recordInbound(JSON.stringify({ type: "ready", streamId: "stream-before" }));
  const previousSession = wsTelemetryState.session;

  startTelemetrySession(true);

  assert.equal(wsTelemetryState.session, previousSession + 1);
  assert.equal(wsTelemetryState.inbound, 0);
  assert.equal(wsTelemetryState.outbound, 0);
  assert.equal(wsTelemetryState.readyCount, 0);
  assert.equal(wsTelemetryState.streamId, "");
  assert.equal(wsFrames.length, 0);
  assert.equal(wsTypeMetrics.value.length, 0);
  assert.equal(wsTopicMetrics.value.length, 0);
});
