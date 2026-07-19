import { computed, reactive } from "vue";

export type FrameDirection = "inbound" | "outbound";
export type IncidentSeverity = "warning" | "error";

export interface FrameRecord {
  id: number;
  at: string;
  direction: FrameDirection;
  type: string;
  topic: string;
  bytes: number;
  seq?: number;
  traceId?: string;
  payload: unknown;
  parseStatus: "parsed" | "invalid_json" | "binary";
}

export interface LifecycleRecord {
  id: number;
  at: string;
  kind: string;
  title: string;
  severity?: IncidentSeverity;
  detail?: unknown;
}

interface DirectionMetric {
  total: number;
  inbound: number;
  outbound: number;
  bytes: number;
  lastBytes: number;
  lastAt: string;
  lastDirection: FrameDirection;
}

export interface TypeMetric extends DirectionMetric { type: string }
export interface TopicMetric extends DirectionMetric {
  topic: string;
  lastType: string;
  lastSeq?: number;
}

const MAX_RECORDS = 5_000;
const encoder = new TextEncoder();
let id = 0;
let lastInboundAt = 0;
const frames = reactive<FrameRecord[]>([]);
const lifecycle = reactive<LifecycleRecord[]>([]);
const typeMetrics = reactive<Record<string, TypeMetric>>({});
const topicMetrics = reactive<Record<string, TopicMetric>>({});

export const wsTelemetryState = reactive({
  session: 1,
  startedAt: new Date().toISOString(),
  inbound: 0,
  outbound: 0,
  bytes: 0,
  averageInboundGapMs: 0,
  errors: 0,
  warnings: 0,
  readyCount: 0,
  reconnectCount: 0,
  connectionId: "",
  streamId: "",
  lastClose: null as Record<string, unknown> | null,
});

export const wsFrames = frames;
export const wsLifecycle = lifecycle;
export const wsTypeMetrics = computed(() =>
  Object.values(typeMetrics).sort((a, b) => b.total - a.total),
);
export const wsTopicMetrics = computed(() =>
  Object.values(topicMetrics).sort((a, b) => b.total - a.total),
);
export const wsIncidents = computed(() =>
  lifecycle.filter((entry) => entry.severity),
);
export const wsTimeline = computed(() =>
  [
    ...frames.map((entry) => ({ ...entry, category: "frame" as const })),
    ...lifecycle.map((entry) => ({ ...entry, category: "lifecycle" as const })),
  ].sort((a, b) => b.id - a.id),
);

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function messageFields(payload: unknown) {
  const value = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : {};
  const item = value.item && typeof value.item === "object"
    ? value.item as Record<string, unknown>
    : {};
  const items = Array.isArray(value.items) ? value.items : [];
  const topics = items
    .map((entry) => entry && typeof entry === "object" ? stringValue((entry as Record<string, unknown>).topic) : "")
    .filter(Boolean);
  const topic = stringValue(item.topic) || stringValue(value.topic) || topics.join(",");
  return {
    type: stringValue(value.type) || "unknown",
    topic,
    seq: typeof value.seq === "number" ? value.seq : undefined,
    traceId: stringValue(value.traceId) || undefined,
  };
}

function updateMetrics(record: FrameRecord): void {
  const type = typeMetrics[record.type] ?? (typeMetrics[record.type] = {
    type: record.type, total: 0, inbound: 0, outbound: 0, bytes: 0,
    lastBytes: 0, lastAt: record.at, lastDirection: record.direction,
  });
  type.total += 1;
  type[record.direction] += 1;
  type.bytes += record.bytes;
  type.lastBytes = record.bytes;
  type.lastAt = record.at;
  type.lastDirection = record.direction;
  const topics = record.topic.split(",").map((topic) => topic.trim()).filter(Boolean);
  for (const topicName of topics) {
    const topic = topicMetrics[topicName] ?? (topicMetrics[topicName] = {
      topic: topicName, total: 0, inbound: 0, outbound: 0, bytes: 0,
      lastBytes: 0, lastAt: record.at, lastDirection: record.direction,
      lastType: record.type,
    });
    topic.total += 1;
    topic[record.direction] += 1;
    topic.bytes += record.bytes;
    topic.lastBytes = record.bytes;
    topic.lastAt = record.at;
    topic.lastDirection = record.direction;
    topic.lastType = record.type;
    if (record.seq != null) topic.lastSeq = record.seq;
  }
}

function pushFrame(record: Omit<FrameRecord, "id" | "at">): void {
  const entry = { ...record, id: ++id, at: new Date().toISOString() };
  frames.unshift(entry);
  if (frames.length > MAX_RECORDS) frames.length = MAX_RECORDS;
  wsTelemetryState[entry.direction] += 1;
  wsTelemetryState.bytes += entry.bytes;
  updateMetrics(entry);
  if (entry.direction === "inbound") {
    const now = Date.now();
    if (lastInboundAt) {
      const gap = now - lastInboundAt;
      wsTelemetryState.averageInboundGapMs = wsTelemetryState.averageInboundGapMs
        ? wsTelemetryState.averageInboundGapMs * 0.9 + gap * 0.1
        : gap;
    }
    lastInboundAt = now;
    if (entry.type === "ready") {
      wsTelemetryState.readyCount += 1;
      const payload = entry.payload as Record<string, unknown>;
      wsTelemetryState.connectionId = stringValue(payload.connectionId);
      wsTelemetryState.streamId = stringValue(payload.streamId);
    }
    if (entry.type === "error") {
      recordLifecycle("server_error", "Server error", entry.payload, "error");
    }
    if (entry.type === "backpressure") {
      recordLifecycle("backpressure", "Backpressure", entry.payload, "warning");
    }
  }
}

export function recordOutbound(payload: unknown, raw: string): void {
  const fields = messageFields(payload);
  pushFrame({ direction: "outbound", bytes: encoder.encode(raw).byteLength, payload, parseStatus: "parsed", ...fields });
}

export function recordInbound(raw: string): void {
  const bytes = encoder.encode(raw).byteLength;
  try {
    const payload = JSON.parse(raw) as unknown;
    const fields = messageFields(payload);
    pushFrame({ direction: "inbound", bytes, payload, parseStatus: "parsed", ...fields });
  } catch {
    pushFrame({ direction: "inbound", bytes, payload: raw.slice(0, 4_096), parseStatus: "invalid_json", type: "invalid_json", topic: "" });
    recordLifecycle("parse_error", "Invalid JSON frame", { bytes, preview: raw.slice(0, 512) }, "error");
  }
}

export function recordLifecycle(
  kind: string,
  title: string,
  detail?: unknown,
  severity?: IncidentSeverity,
): void {
  lifecycle.unshift({ id: ++id, at: new Date().toISOString(), kind, title, detail, severity });
  if (lifecycle.length > MAX_RECORDS) lifecycle.length = MAX_RECORDS;
  if (severity === "error") wsTelemetryState.errors += 1;
  if (severity === "warning") wsTelemetryState.warnings += 1;
}

export function startTelemetrySession(reconnect = false): void {
  frames.length = 0;
  lifecycle.length = 0;
  for (const key of Object.keys(typeMetrics)) delete typeMetrics[key];
  for (const key of Object.keys(topicMetrics)) delete topicMetrics[key];
  Object.assign(wsTelemetryState, {
    session: wsTelemetryState.session + (reconnect ? 1 : 0),
    startedAt: new Date().toISOString(), inbound: 0, outbound: 0, bytes: 0,
    averageInboundGapMs: 0, errors: 0, warnings: 0, readyCount: 0,
    connectionId: "", streamId: "", lastClose: null,
  });
  lastInboundAt = 0;
}

export function recordClose(detail: Record<string, unknown>): void {
  wsTelemetryState.lastClose = detail;
  recordLifecycle("close", `Connection closed · ${String(detail.code ?? "unknown")}`, detail,
    detail.code === 1000 ? undefined : "warning");
}

export function incrementReconnect(): void {
  wsTelemetryState.reconnectCount += 1;
}

