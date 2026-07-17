export const REALTIME_PROTOCOL_VERSION = "sports-realtime.v1";
export const REALTIME_WS_PATH = "/gateway/ws/stream";

export interface HomeBoardTopicItem {
  topic: "home.board";
  moduleType?: "HOME_MAIN_BOARD";
  showScope?: string;
  sportCode?: string;
  groupMode?: string;
  timeFilterCodes?: string;
  leagueChipCode?: string;
  selectedTournamentCodes?: string;
  primaryMarketTabCode?: string;
  secondaryMarketTabCode?: string;
  marketTabCode?: string;
  marketLine?: string;
  pageNum?: number;
  pageSize?: number;
}

export type TopicItem = HomeBoardTopicItem;

export interface SnapshotMessage {
  type: "topic_snapshot";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  streamId: string;
  serverTime: string;
  traceId: string;
  item: TopicItem;
  seq: number;
  collection?: {
    ids?: string[];
    items?: Record<string, Record<string, unknown>>;
    totalCount?: number;
    truncated?: boolean;
  };
  rows?: unknown[];
  entities?: {
    rows?: unknown[];
    events?: unknown[];
    markets?: unknown[];
    outcomes?: unknown[];
  };
}

export interface TopicDeltaMessage {
  type: "topic_delta";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  streamId: string;
  serverTime: string;
  traceId: string;
  item: TopicItem;
  seq: number;
  ops?: Array<Record<string, unknown>>;
  rows?: unknown[];
  entities?: {
    rows?: unknown[];
    events?: unknown[];
    markets?: unknown[];
    outcomes?: unknown[];
  };
  outcomeChanges?: unknown[];
}

export interface OutcomeDeltaMessage {
  type: "outcome_delta";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  streamId: string;
  serverTime: string;
  traceId: string;
  item: TopicItem;
  seq: number;
  format?: "object.v1" | "grouped_tuple.v1";
  fields?: string[];
  changes?: unknown[];
  changesByEvent?: Array<{
    eventId: string;
    markets: Array<{
      sourceMarketKey: string;
      outcomes: unknown[];
    }>;
  }>;
}

export interface ReadyMessage {
  type: "ready";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  connectionId: string;
  streamId: string;
  serverTime: string;
  heartbeatMs: number;
  maxClientMessageBytes: number;
  maxServerMessageBytes: number;
  maxTopicsPerMessage: number;
  /** Legacy alias for maxServerMessageBytes. */
  maxMessageBytes?: number;
}

export interface ErrorMessage {
  type: "error";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  serverTime: string;
  traceId: string;
  code: string;
  message: string;
  detail?: unknown;
}

export interface BackpressureMessage {
  type: "backpressure";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  serverTime: string;
  traceId: string;
  retryAfterMs: number;
  actions: string[];
  scope?: "connection" | "topic";
  item?: TopicItem;
}

export interface TicketUpdateMessage {
  type: "ticket_update";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  serverTime: string;
  traceId: string;
  notificationId: string;
  ticketId: string;
  status: string;
  payload: Record<string, unknown>;
}

export interface UserNotificationMessage {
  type: "user_notification";
  protocolVersion: typeof REALTIME_PROTOCOL_VERSION;
  serverTime: string;
  traceId: string;
  notificationId: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
}

export type ServerMessage =
  | ReadyMessage
  | SnapshotMessage
  | TopicDeltaMessage
  | OutcomeDeltaMessage
  | ErrorMessage
  | BackpressureMessage
  | TicketUpdateMessage
  | UserNotificationMessage
  | { type: "heartbeat"; serverTime: number }
  | { type: "pong"; clientTime?: number; serverTime?: string }
  | { type: "ping"; serverTime?: string };

export interface HelloAuth {
  scheme: "ticket" | "bearer";
  credential: string;
}

export type ClientMessage =
  | {
      type: "hello";
      protocolVersion: string;
      client?: string;
      appVersion?: string;
      device?: string;
      auth?: HelloAuth;
    }
  | { type: "subscribe"; items?: unknown[] }
  | { type: "unsubscribe"; items?: unknown[] }
  | {
      type: "resync";
      items?: unknown[];
      reason?: string;
      gaps?: Record<string, { lastSeq?: number; receivedSeq?: number }>;
    }
  | {
      type: "watch_collection_range";
      item?: unknown;
      loadedIds?: string[];
      visibleIds?: string[];
      pageNum?: number;
      pageSize?: number;
    }
  | { type: "ping"; clientTime?: number }
  | { type: "pong"; clientTime?: number }
  | { type: "notification_ack"; notificationId?: string };

export interface ConnectionRangeState {
  loadedIds: string[];
  visibleIds: string[];
  pageNum?: number;
  pageSize?: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function normalizePositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.floor(value))
    : undefined;
}

export function normalizeTopicItem(raw: unknown): TopicItem | null {
  if (!isRecord(raw)) return null;
  const topic = normalizeText(raw.topic);
  if (topic !== "home.board") return null;

  return {
    topic,
    moduleType: "HOME_MAIN_BOARD",
    showScope: normalizeText(raw.showScope) || undefined,
    sportCode: normalizeText(raw.sportCode) || undefined,
    groupMode: normalizeText(raw.groupMode) || undefined,
    timeFilterCodes: normalizeText(raw.timeFilterCodes) || undefined,
    leagueChipCode: normalizeText(raw.leagueChipCode) || undefined,
    selectedTournamentCodes:
      normalizeText(raw.selectedTournamentCodes) || undefined,
    primaryMarketTabCode:
      normalizeText(raw.primaryMarketTabCode) || undefined,
    secondaryMarketTabCode:
      normalizeText(raw.secondaryMarketTabCode) || undefined,
    marketTabCode: normalizeText(raw.marketTabCode) || undefined,
    marketLine: normalizeText(raw.marketLine) || undefined,
    pageNum: normalizePositiveInteger(raw.pageNum),
    pageSize: normalizePositiveInteger(raw.pageSize),
  };
}

export function getTopicKey(item: TopicItem): string {
  return JSON.stringify(item);
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function traceId(prefix = "trace"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
