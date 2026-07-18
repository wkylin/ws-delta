import type { Server } from "node:http";
import type { Duplex } from "node:stream";
import WebSocket, { type RawData, WebSocketServer } from "ws";
import { isAllowedMockDevelopmentOrigin } from "../devOrigin";
import {
  REALTIME_PROTOCOL_VERSION,
  getTopicKey,
  isRecord,
  normalizeText,
  normalizeTopicItem,
  nowIso,
  traceId,
  type BackpressureMessage,
  type ClientMessage,
  type ErrorMessage,
  type HomeBoardTopicItem,
  type OutcomeDeltaMessage,
  type ReadyMessage,
  type ServerMessage,
  type SnapshotMessage,
  type TopicDeltaMessage,
} from "../protocol";
import { BoardStore } from "./boardStore";
import { decideSend } from "./backpressure";
import { GatewayMetrics, PrometheusExporter, type GatewayMetricsSnapshot } from "./metrics";
import { createRealtimeBus, createSnapshotStore, type RealtimeBus, type RealtimeEvent, type SnapshotStore } from "../distributed";
import type { ConnectionState, MockRealtimeConfig } from "./types";

const MAX_SEQUENCE = 1_000_000_000_000;

function isClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "hello": return typeof value.protocolVersion === "string";
    case "subscribe": case "unsubscribe": return value.items === undefined || Array.isArray(value.items);
    case "resync": return value.items === undefined || Array.isArray(value.items);
    case "watch_collection_range": return value.item === undefined || isRecord(value.item);
    case "ping": case "pong": case "notification_ack": return true;
    default: return false;
  }
}

export class WsGateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Map<string, ConnectionState>();
  private readonly connectionBySocket = new WeakMap<WebSocket, ConnectionState>();
  private readonly sequences = new Map<string, number>();
  private readonly seqGaps = new Map<string, number>();
  private readonly metrics = new GatewayMetrics();
  private readonly prometheus = new PrometheusExporter();
  private readonly bus: RealtimeBus;
  private readonly snapshots: SnapshotStore;
  private distributedStarted = false;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private outcomeTimer: NodeJS.Timeout | null = null;
  private collectionTimer: NodeJS.Timeout | null = null;

  constructor(private readonly config: MockRealtimeConfig, private readonly board: BoardStore) {
    this.wss = new WebSocketServer({ noServer: true, maxPayload: config.maxClientMessageBytes, perMessageDeflate: false });
    this.wss.on("connection", (ws: WebSocket) => this.handleConnection(ws));
    const options = { instanceId: config.instanceId, ...config.distributed };
    this.bus = createRealtimeBus(options);
    this.snapshots = createSnapshotStore(options);
  }

  attach(server: Server): void {
    server.on("upgrade", (request, socket, head) => {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname !== this.config.wsPath) return this.rejectUpgrade(socket, 404, "WebSocket endpoint not found");
      const origin = normalizeText(request.headers.origin);
      const allowed = !origin || this.config.allowedOrigins.includes(origin) || isAllowedMockDevelopmentOrigin(origin);
      if (!allowed || (!origin && !this.config.allowMissingOrigin)) return this.rejectUpgrade(socket, 403, "WebSocket Origin is not allowed");
      this.wss.handleUpgrade(request, socket, head, (ws) => this.wss.emit("connection", ws, request));
    });
  }

  start(): void {
    void this.startDistributed();
    if (!this.heartbeatTimer && this.config.heartbeatMs > 0) this.heartbeatTimer = setInterval(() => this.heartbeat(), this.config.heartbeatMs);
    if (!this.pingTimer) this.pingTimer = setInterval(() => this.checkLiveness(), this.config.pingIntervalMs);
    if (!this.outcomeTimer) this.outcomeTimer = setInterval(() => this.emitOutcomeBatch(), 800);
    if (!this.collectionTimer) this.collectionTimer = setInterval(() => this.emitCollectionBatch(), 6_000);
  }

  stop(): void {
    for (const timer of [this.heartbeatTimer, this.pingTimer, this.outcomeTimer, this.collectionTimer]) if (timer) clearInterval(timer);
    this.heartbeatTimer = this.pingTimer = this.outcomeTimer = this.collectionTimer = null;
    for (const connection of this.connections.values()) { this.clearHelloTimer(connection); connection.ws.close(); }
    this.connections.clear(); this.sequences.clear(); this.seqGaps.clear();
    void this.bus.stop();
    void this.snapshots.stop();
  }

  connectionCount(): number { return this.connections.size; }
  topicCount(): number { return this.sequences.size; }
  metricsSnapshot(): GatewayMetricsSnapshot {
    const connections = Array.from(this.connections.values());
    return this.metrics.snapshot(
      connections.length,
      connections.reduce((sum, connection) => sum + connection.subscribedTopics.size, 0),
      connections.map((connection) => connection.ws.bufferedAmount),
    );
  }
  prometheusMetrics(): Promise<string> { return this.prometheus.render(this.metricsSnapshot()); }
  distributedMode(): string { return this.bus.mode; }
  debugConnections(): unknown[] {
    return Array.from(this.connections.values()).map((connection) => ({ id: connection.id, helloReceived: connection.helloReceived, topics: Array.from(connection.subscribedTopics.values()), ranges: Object.fromEntries(connection.ranges) }));
  }

  forceSeqGap(item: HomeBoardTopicItem, skip: number): boolean {
    const key = getTopicKey(item);
    if (!Array.from(this.connections.values()).some((connection) => connection.subscribedTopics.has(key))) return false;
    this.seqGaps.set(key, skip); this.metrics.sequenceGap(skip); return true;
  }

  sendBackpressure(retryAfterMs: number, actions: string[]): void {
    const message: BackpressureMessage = { type: "backpressure", protocolVersion: REALTIME_PROTOCOL_VERSION, serverTime: nowIso(), traceId: traceId("backpressure"), retryAfterMs, actions, scope: "connection" };
    for (const connection of this.connections.values()) this.send(connection.ws, message);
  }

  emitOutcomeBatch(): number {
    if (this.bus.mode !== "local") return this.publishOutcomeBatch();
    let delivered = 0;
    for (const connection of this.connections.values()) for (const item of connection.subscribedTopics.values()) {
      const changes = this.board.mutateOutcomes(item, this.trackedIds(connection, item));
      if (!changes.length) continue;
      const message: OutcomeDeltaMessage = { type: "outcome_delta", protocolVersion: REALTIME_PROTOCOL_VERSION, streamId: connection.id, serverTime: nowIso(), traceId: traceId("outcome"), item, seq: this.nextSeq(connection.id, item), changes };
      if (this.send(connection.ws, message)) delivered += 1;
    }
    return delivered;
  }

  emitCollectionBatch(): number {
    if (this.bus.mode !== "local") return this.publishCollectionBatch();
    let delivered = 0;
    for (const connection of this.connections.values()) for (const item of connection.subscribedTopics.values()) {
      const delta = this.board.statusDelta(item, this.trackedIds(connection, item));
      if (!delta) continue;
      this.setTrackedIds(connection, item, delta.ids);
      const message: TopicDeltaMessage = { type: "topic_delta", protocolVersion: REALTIME_PROTOCOL_VERSION, streamId: connection.id, serverTime: nowIso(), traceId: traceId("topic"), item, seq: this.nextSeq(connection.id, item), ops: delta.ops };
      if (this.send(connection.ws, message)) delivered += 1;
    }
    return delivered;
  }

  private handleConnection(ws: WebSocket): void {
    const connection: ConnectionState = { id: `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, ws, helloReceived: !this.config.requireHello, authenticated: !this.config.requireHello, helloTimeoutTimer: null, subscribedTopics: new Map(), ranges: new Map(), isAlive: true, droppedRecoverableMessages: 0, backpressureNotified: false };
    this.metrics.connectionOpened();
    this.connections.set(connection.id, connection); this.connectionBySocket.set(ws, connection); this.armHelloTimer(connection);
    ws.on("message", (buffer: RawData, binary: boolean) => this.receive(connection, buffer, binary));
    ws.on("pong", () => { connection.isAlive = true; });
    ws.on("close", () => { this.metrics.connectionClosed(); this.clearHelloTimer(connection); this.connections.delete(connection.id); this.clearSequences(connection.id); });
    ws.on("error", (error) => console.warn(`[mock-realtime] WebSocket ${connection.id} error`, error.message));
    if (!this.config.requireHello) this.send(ws, this.ready(connection.id));
  }

  private receive(connection: ConnectionState, buffer: RawData, binary: boolean): void {
    this.metrics.inbound(Buffer.byteLength(buffer.toString()));
    if (binary) { this.fail(connection, "BINARY_NOT_SUPPORTED", "Binary frames are not supported", 1003); return; }
    let value: unknown;
    try { value = JSON.parse(buffer.toString()); } catch { this.fail(connection, "INVALID_JSON", "Invalid JSON payload", 1007); return; }
    if (!isClientMessage(value)) { this.fail(connection, "INVALID_ENVELOPE", "Invalid WebSocket message envelope", 1002); return; }
    if (this.config.requireHello && !connection.helloReceived && value.type !== "hello") { this.fail(connection, "HELLO_REQUIRED", "hello must be the first WebSocket message", 1002); return; }
    this.handleMessage(connection, value);
  }

  private handleMessage(connection: ConnectionState, message: ClientMessage): void {
    switch (message.type) {
      case "hello": this.hello(connection, message); return;
      case "subscribe": this.subscribe(connection, message.items); return;
      case "unsubscribe": this.unsubscribe(connection, message.items); return;
      case "resync": this.resync(connection, message.items); return;
      case "watch_collection_range": this.watchRange(connection, message); return;
      case "ping": this.send(connection.ws, { type: "pong", clientTime: message.clientTime, serverTime: nowIso() }); return;
      case "pong": connection.isAlive = true; return;
      case "notification_ack": return;
    }
  }

  private hello(connection: ConnectionState, message: Extract<ClientMessage, { type: "hello" }>): void {
    if (connection.helloReceived && this.config.requireHello) { this.fail(connection, "HELLO_ALREADY_RECEIVED", "hello can only be sent once per WebSocket connection", 1002); return; }
    connection.helloReceived = true; this.clearHelloTimer(connection);
    if (message.protocolVersion !== REALTIME_PROTOCOL_VERSION) { this.fail(connection, "PROTOCOL_VERSION_UNSUPPORTED", `Expected ${REALTIME_PROTOCOL_VERSION}, received ${message.protocolVersion}`, 1002); return; }
    if (this.config.authToken && normalizeText(message.auth?.credential) !== this.config.authToken) { this.fail(connection, message.auth ? "AUTH_FAILED" : "AUTH_REQUIRED", "WebSocket authentication failed", message.auth ? 4403 : 4401); return; }
    connection.authenticated = true; this.send(connection.ws, this.ready(connection.id));
  }

  private subscribe(connection: ConnectionState, rawItems?: unknown[]): void {
    if (!connection.authenticated) { this.fail(connection, "AUTH_REQUIRED", "Authentication is required before subscribing", 4401); return; }
    const items = this.normalizeItems(connection, rawItems, "subscribe"); if (!items) return;
    const newKeys = items.filter((item) => !connection.subscribedTopics.has(getTopicKey(item)));
    if (connection.subscribedTopics.size + newKeys.length > this.config.maxSubscriptionsPerConnection) { this.sendError(connection, "SUBSCRIPTION_LIMIT_EXCEEDED", "Per-connection subscription limit exceeded"); return; }
    for (const item of items) { connection.subscribedTopics.set(getTopicKey(item), item); this.sendSnapshot(connection, item); }
  }

  private unsubscribe(connection: ConnectionState, rawItems?: unknown[]): void {
    const items = this.normalizeItems(connection, rawItems, "unsubscribe"); if (!items) return;
    for (const item of items) { const key = getTopicKey(item); connection.subscribedTopics.delete(key); connection.ranges.delete(key); this.sequences.delete(`${connection.id}:${key}`); }
  }

  private resync(connection: ConnectionState, rawItems?: unknown[]): void {
    this.metrics.resync();
    const items = this.normalizeItems(connection, rawItems, "resync"); if (!items) return;
    for (const item of items) {
      if (!connection.subscribedTopics.has(getTopicKey(item))) {
        this.sendError(connection, "TOPIC_NOT_SUBSCRIBED", "Cannot resync a topic that is not subscribed", { item });
        continue;
      }
      void this.sendSnapshotFromCache(connection, item);
    }
  }

  private watchRange(connection: ConnectionState, message: Extract<ClientMessage, { type: "watch_collection_range" }>): void {
    const item = normalizeTopicItem(message.item); if (!item) { this.sendError(connection, "INVALID_TOPIC_ITEM", "Invalid range topic item"); return; }
    if ((message.loadedIds?.length ?? 0) > this.config.maxRangeIds || (message.visibleIds?.length ?? 0) > this.config.maxRangeIds) { this.sendError(connection, "RANGE_ID_LIMIT_EXCEEDED", "Collection range contains too many event IDs"); return; }
    const key = getTopicKey(item);
    if (!connection.ranges.has(key) && connection.ranges.size >= this.config.maxSubscriptionsPerConnection) { this.sendError(connection, "RANGE_STATE_LIMIT_EXCEEDED", "Per-connection collection range state limit exceeded"); return; }
    connection.ranges.set(key, { loadedIds: this.board.knownIds(message.loadedIds ?? []), visibleIds: this.board.knownIds(message.visibleIds ?? []), pageNum: message.pageNum, pageSize: message.pageSize });
    if (connection.subscribedTopics.has(key)) this.emitOutcomeFor(connection, item);
  }

  private sendSnapshot(connection: ConnectionState, item: HomeBoardTopicItem): void {
    const rows = this.board.snapshotRows(item, connection.ranges.get(getTopicKey(item)));
    const ids = rows.map((row) => String((row as { eventId: string }).eventId));
    this.setTrackedIds(connection, item, ids);
    const message: SnapshotMessage = { type: "topic_snapshot", protocolVersion: REALTIME_PROTOCOL_VERSION, streamId: connection.id, serverTime: nowIso(), traceId: traceId("snapshot"), item, seq: this.nextSeq(connection.id, item), collection: { ids, totalCount: this.board.list(item).length, truncated: ids.length < this.board.list(item).length }, rows };
    void this.snapshots.set(`sports:realtime:snapshot:${getTopicKey(item)}`, JSON.stringify(message), this.config.distributed.snapshotTtlSeconds);
    this.send(connection.ws, message);
  }

  private async sendSnapshotFromCache(connection: ConnectionState, item: HomeBoardTopicItem): Promise<void> {
    const key = `sports:realtime:snapshot:${getTopicKey(item)}`;
    const cached = await this.snapshots.get(key).catch(() => null);
    if (!cached) { this.sendSnapshot(connection, item); return; }
    try {
      const baseline = JSON.parse(cached) as SnapshotMessage;
      const rows = Array.isArray(baseline.rows) ? baseline.rows : [];
      const ids = rows.map((row) => isRecord(row) ? normalizeText(row.eventId || row.id) : "").filter(Boolean);
      this.setTrackedIds(connection, item, ids);
      this.send(connection.ws, { ...baseline, streamId: connection.id, serverTime: nowIso(), traceId: traceId("snapshot-cache"), item, seq: this.nextSeq(connection.id, item) });
    } catch {
      this.sendSnapshot(connection, item);
    }
  }

  private async startDistributed(): Promise<void> {
    if (this.distributedStarted) return;
    try {
      await this.bus.start((event) => this.deliverDistributedEvent(event));
      this.distributedStarted = true;
    } catch (error) {
      console.error(`[mock-realtime] distributed runtime unavailable (${this.bus.mode})`, error);
    }
  }

  private deliverDistributedEvent(event: RealtimeEvent): void {
    for (const connection of this.connections.values()) {
      const item = connection.subscribedTopics.get(event.topicKey);
      if (!item) continue;
      if (event.kind === "outcome") {
        const changes = Array.isArray(event.payload.changes) ? event.payload.changes.filter((change) => {
          if (!isRecord(change)) return false;
          const tracked = this.trackedIds(connection, item);
          return !tracked.length || tracked.includes(normalizeText(change.eventId));
        }) : [];
        if (!changes.length) continue;
        this.send(connection.ws, { type: "outcome_delta", protocolVersion: REALTIME_PROTOCOL_VERSION, streamId: connection.id, serverTime: nowIso(), traceId: traceId("outcome"), item, seq: this.nextSeq(connection.id, item), changes });
      } else {
        const ops = Array.isArray(event.payload.ops) ? event.payload.ops : [];
        this.send(connection.ws, { type: "topic_delta", protocolVersion: REALTIME_PROTOCOL_VERSION, streamId: connection.id, serverTime: nowIso(), traceId: traceId("topic"), item, seq: this.nextSeq(connection.id, item), ops });
      }
    }
  }

  private publishOutcomeBatch(): number {
    const topics = new Map<string, HomeBoardTopicItem>();
    for (const connection of this.connections.values()) for (const item of connection.subscribedTopics.values()) topics.set(getTopicKey(item), item);
    for (const [topicKey, item] of topics) {
      const changes = this.board.mutateOutcomes(item, []);
      if (!changes.length) continue;
      void this.bus.publish({ eventId: traceId("event"), originInstanceId: this.config.instanceId, topicKey, kind: "outcome", payload: { changes }, publishedAt: nowIso() });
    }
    return topics.size;
  }

  private publishCollectionBatch(): number {
    const topics = new Map<string, HomeBoardTopicItem>();
    for (const connection of this.connections.values()) for (const item of connection.subscribedTopics.values()) topics.set(getTopicKey(item), item);
    for (const [topicKey, item] of topics) {
      const delta = this.board.statusDelta(item, []);
      if (!delta) continue;
      void this.bus.publish({ eventId: traceId("event"), originInstanceId: this.config.instanceId, topicKey, kind: "topic", payload: { ops: delta.ops }, publishedAt: nowIso() });
    }
    return topics.size;
  }

  private emitOutcomeFor(connection: ConnectionState, item: HomeBoardTopicItem): void {
    const changes = this.board.mutateOutcomes(item, this.trackedIds(connection, item)); if (!changes.length) return;
    this.send(connection.ws, { type: "outcome_delta", protocolVersion: REALTIME_PROTOCOL_VERSION, streamId: connection.id, serverTime: nowIso(), traceId: traceId("outcome"), item, seq: this.nextSeq(connection.id, item), changes });
  }

  private normalizeItems(connection: ConnectionState, rawItems: unknown[] | undefined, operation: string): HomeBoardTopicItem[] | null {
    const items = rawItems ?? [];
    if (items.length > this.config.maxTopicsPerMessage) { this.sendError(connection, "TOPIC_BATCH_LIMIT_EXCEEDED", "Topic batch contains too many items"); return null; }
    const normalized: HomeBoardTopicItem[] = [];
    for (const raw of items) { const item = normalizeTopicItem(raw); if (item) normalized.push(item); else this.sendError(connection, "INVALID_TOPIC_ITEM", "Invalid topic item", { operation, item: raw }); }
    return normalized;
  }

  private nextSeq(scope: string, item: HomeBoardTopicItem): number {
    const key = `${scope}:${getTopicKey(item)}`; const previous = this.sequences.get(key) ?? 99; const topicKey = getTopicKey(item); const gap = this.seqGaps.get(topicKey) ?? 0;
    const next = Math.min(MAX_SEQUENCE, previous + 1 + gap); this.sequences.set(key, next); if (gap) this.seqGaps.delete(topicKey); return next;
  }
  private trackedIds(connection: ConnectionState, item: HomeBoardTopicItem): string[] { const range = connection.ranges.get(getTopicKey(item)); return range?.visibleIds.length ? range.visibleIds : range?.loadedIds ?? []; }
  private setTrackedIds(connection: ConnectionState, item: HomeBoardTopicItem, ids: string[]): void { const key = getTopicKey(item); const previous = connection.ranges.get(key); connection.ranges.set(key, { loadedIds: ids, visibleIds: previous?.visibleIds ?? [], pageNum: previous?.pageNum, pageSize: previous?.pageSize }); }
  private ready(id: string): ReadyMessage { return { type: "ready", protocolVersion: REALTIME_PROTOCOL_VERSION, connectionId: id, streamId: id, serverTime: nowIso(), heartbeatMs: this.config.heartbeatMs, maxClientMessageBytes: this.config.maxClientMessageBytes, maxServerMessageBytes: this.config.maxServerMessageBytes, maxTopicsPerMessage: this.config.maxTopicsPerMessage, maxMessageBytes: this.config.maxServerMessageBytes }; }
  private error(code: string, message: string, detail?: unknown): ErrorMessage { return { type: "error", protocolVersion: REALTIME_PROTOCOL_VERSION, serverTime: nowIso(), traceId: traceId("error"), code, message, ...(detail === undefined ? {} : { detail }) }; }
  private sendError(connection: ConnectionState, code: string, message: string, detail?: unknown): void { this.send(connection.ws, this.error(code, message, detail)); }
  private fail(connection: ConnectionState, code: string, message: string, closeCode: number): void { this.sendError(connection, code, message); connection.ws.close(closeCode, message); }
  private clearSequences(scope: string): void { for (const key of this.sequences.keys()) if (key.startsWith(`${scope}:`)) this.sequences.delete(key); }
  private armHelloTimer(connection: ConnectionState): void { if (!this.config.requireHello) return; connection.helloTimeoutTimer = setTimeout(() => { if (!connection.helloReceived) this.fail(connection, "HELLO_TIMEOUT", "hello was not received before the authentication deadline", 4408); }, this.config.helloTimeoutMs); connection.helloTimeoutTimer.unref(); }
  private clearHelloTimer(connection: ConnectionState): void { if (connection.helloTimeoutTimer) clearTimeout(connection.helloTimeoutTimer); connection.helloTimeoutTimer = null; }
  private checkLiveness(): void { for (const connection of this.connections.values()) { if (connection.ws.readyState !== WebSocket.OPEN) continue; if (!connection.isAlive) { connection.ws.terminate(); continue; } connection.isAlive = false; connection.ws.ping(); } }
  private heartbeat(): void { for (const connection of this.connections.values()) if (connection.helloReceived) this.send(connection.ws, { type: "heartbeat", serverTime: Date.now() }); }
  private rejectUpgrade(socket: Duplex, status: number, message: string): void { const body = `${message}\n`; socket.end(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`); }
  private send(ws: WebSocket, message: ServerMessage): boolean {
    if (ws.readyState !== WebSocket.OPEN) return false;
    const encoded = JSON.stringify(message); const bytes = Buffer.byteLength(encoded); const connection = this.connectionBySocket.get(ws); const recoverable = message.type === "topic_delta" || message.type === "outcome_delta";
    if (bytes > this.config.maxServerMessageBytes) { if (recoverable) this.backpressure(ws); else ws.close(1011, "Server message exceeds advertised limit"); return false; }
    const decision = decideSend(ws.bufferedAmount, bytes, recoverable, this.config);
    if (decision === "close_slow_consumer") { this.metrics.slowConsumer(); ws.close(1013, "Slow consumer"); return false; }
    if (decision === "drop_recoverable") { this.metrics.recoverableDrop(); if (connection) { connection.droppedRecoverableMessages += 1; if (!connection.backpressureNotified) { connection.backpressureNotified = true; this.backpressure(ws); } if (connection.droppedRecoverableMessages >= this.config.maxRecoverableDrops) { this.metrics.slowConsumer(); ws.close(1013, "Slow consumer"); } } return false; }
    ws.send(encoded); this.metrics.outbound(message.type, bytes); return true;
  }
  private backpressure(ws: WebSocket): void { const message: BackpressureMessage = { type: "backpressure", protocolVersion: REALTIME_PROTOCOL_VERSION, serverTime: nowIso(), traceId: traceId("backpressure"), retryAfterMs: Math.max(500, this.config.pingIntervalMs), actions: ["resync", "reduce_range"], scope: "connection" }; const encoded = JSON.stringify(message); const bytes = Buffer.byteLength(encoded); if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount + bytes < this.config.bufferedAmountCloseBytes) { ws.send(encoded); this.metrics.backpressure(); this.metrics.outbound(message.type, bytes); } }
}
