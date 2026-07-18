import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import WebSocket from "ws";
import { BoardStore } from "../server/src/engine/boardStore";
import { WsGateway } from "../server/src/engine/wsGateway";
import type { MockRealtimeConfig } from "../server/src/engine/types";
import { normalizeTopicItem } from "../server/src/protocol";

const item = {
  topic: "home.board" as const,
  moduleType: "HOME_MAIN_BOARD" as const,
  sportCode: "all",
  showScope: "all",
  groupMode: "league",
  primaryMarketTabCode: "1x2",
  pageNum: 1,
  pageSize: 10,
};

function config(): MockRealtimeConfig {
  return {
    wsPath: "/gateway/ws/stream",
    heartbeatMs: 0,
    maxClientMessageBytes: 1_000_000,
    maxServerMessageBytes: 1_000_000,
    allowedOrigins: [],
    allowMissingOrigin: true,
    requireHello: false,
    helloTimeoutMs: 1_000,
    maxSubscriptionsPerConnection: 10,
    maxTopicsPerMessage: 10,
    maxRangeIds: 100,
    maxNotificationAcks: 100,
    pingIntervalMs: 10_000,
    bufferedAmountHighWaterBytes: 10_000,
    bufferedAmountCloseBytes: 20_000,
    maxRecoverableDrops: 3,
    instanceId: "test-instance",
    distributed: {
      kafkaBrokers: [],
      kafkaTopic: "test.events",
      kafkaGroupId: "test-group",
      channel: "test-channel",
      snapshotTtlSeconds: 30,
    },
  };
}

function nextMessage(ws: WebSocket, expectedType: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", onMessage);
      reject(new Error(`timed out waiting for ${expectedType}`));
    }, 1_000);
    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type !== expectedType) return;
      clearTimeout(timeout);
      ws.off("message", onMessage);
      resolve(message);
    };
    ws.on("message", onMessage);
  });
}

test("gateway publishes a snapshot and recovers an injected sequence gap", async () => {
  const server = http.createServer();
  const gateway = new WsGateway(config(), new BoardStore());
  gateway.attach(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const ws = new WebSocket(`ws://127.0.0.1:${address.port}/gateway/ws/stream`);

  try {
    await nextMessage(ws, "ready");
    ws.send(JSON.stringify({ type: "subscribe", items: [item] }));
    const snapshot = await nextMessage(ws, "topic_snapshot");
    assert.equal(snapshot.seq, 100);
    assert.ok(Array.isArray(snapshot.rows));

    assert.equal(gateway.forceSeqGap(normalizeTopicItem(item)!, 2), true);
    gateway.emitOutcomeBatch();
    const outcome = await nextMessage(ws, "outcome_delta");
    assert.equal(outcome.seq, 103);

    ws.send(JSON.stringify({ type: "resync", items: [item], reason: "seq_gap" }));
    const resynced = await nextMessage(ws, "topic_snapshot");
    assert.equal(resynced.seq, 104);
    const metrics = gateway.metricsSnapshot();
    assert.equal(metrics.resyncRequests, 1);
    assert.equal(metrics.sequenceGapSizeInjected, 2);
    assert.equal(metrics.outboundByType.topic_snapshot, 2);
  } finally {
    ws.close();
    gateway.stop();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
