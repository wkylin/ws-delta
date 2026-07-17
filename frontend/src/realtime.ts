import { computed, onBeforeUnmount, reactive, ref } from "vue";
import type {
  BoardRow,
  BoardGroup,
  ConnectionStatus,
  MarketCell,
  ProtocolLog,
  RealtimeStats,
  TopicItem,
  Trend,
} from "./types";

const PROTOCOL_VERSION = "sports-realtime.v1";
const MAX_LOGS = 80;
const RECONNECT_BASE_MS = 600;
const RECONNECT_MAX_MS = 8_000;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function unwrapRow(value: unknown): BoardRow | null {
  const candidate = isRecord(value) && isRecord(value.row) ? value.row : value;
  if (!isRecord(candidate)) return null;
  const id = text(candidate.eventId) || text(candidate.id);
  if (!id || !text(candidate.homeTeam) || !text(candidate.awayTeam)) return null;
  const markets = Array.isArray(candidate.markets)
    ? candidate.markets.filter(isRecord).map((market) => ({
        ...market,
        key:
          text(market.key) ||
          text(market.sourceOutcomeCode) ||
          text(market.outcomeCode),
        label: text(market.label) || text(market.outcomeName) || "Outcome",
        value: numberValue(market.value ?? market.oddsDecimal ?? market.odds) ?? 0,
      }))
    : [];
  return { ...(candidate as unknown as BoardRow), id, markets };
}

function eventIdOf(row: BoardRow): string {
  return row.eventId || row.id;
}

function marketIdentity(market: MarketCell): string {
  return `${market.sourceMarketKey || ""}|${market.sourceOutcomeCode || market.key}`;
}

function topicKey(item: TopicItem): string {
  return JSON.stringify(item);
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / 1_024 / 1_024).toFixed(2)} MiB`;
}

export function useRealtimeBoard() {
  const status = ref<ConnectionStatus>("offline");
  const rows = ref<BoardRow[]>([]);
  const activeTopic = ref<TopicItem>({
    topic: "home.board",
    moduleType: "HOME_MAIN_BOARD",
    siteCode: "ng",
    showScope: "all",
    sportCode: "all",
    groupMode: "league",
    primaryMarketTabCode: "1x2",
    pageNum: 1,
    pageSize: 50,
  });
  const currentSeq = ref(0);
  const streamId = ref("");
  const logs = ref<ProtocolLog[]>([]);
  const stats = reactive<RealtimeStats>({
    messages: 0,
    bytes: 0,
    snapshots: 0,
    topicDeltas: 0,
    outcomeDeltas: 0,
    oddsPatches: 0,
    gaps: 0,
  });
  const flashes = reactive<Record<string, Trend>>({});
  const knownSports = reactive(new Map<string, string>([["all", "All sports"]]));

  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let reconnectAttempt = 0;
  let stopped = false;
  let logId = 0;

  const endpoint =
    (import.meta.env.VITE_WS_URL as string | undefined)?.trim() ||
    "ws://127.0.0.1:8088/gateway/ws/stream";

  const sportOptions = computed(() =>
    Array.from(knownSports, ([id, label]) => ({ id, label })),
  );

  const groups = computed<BoardGroup[]>(() => {
    const grouped = new Map<string, BoardGroup>();
    for (const row of rows.value) {
      const country = row.countryName || row.league?.[0] || "International";
      const league = row.tournamentName || row.league?.[1] || "Other matches";
      const key = `${country}|${league}`;
      const group = grouped.get(key) || { country, league, rows: [] };
      group.rows.push(row);
      grouped.set(key, group);
    }
    return Array.from(grouped.values());
  });

  const lastMessageAt = computed(() => logs.value[0]?.time || "--:--:--");

  function addLog(
    type: string,
    bytes: number,
    summary: string,
    seq?: number,
    tone: ProtocolLog["tone"] = "neutral",
  ) {
    logs.value.unshift({
      id: ++logId,
      time: new Date().toLocaleTimeString([], { hour12: false }),
      type,
      seq,
      bytes,
      summary,
      tone,
    });
    if (logs.value.length > MAX_LOGS) logs.value.length = MAX_LOGS;
  }

  function send(message: RecordValue) {
    if (socket?.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(message));
    return true;
  }

  function subscribe() {
    currentSeq.value = 0;
    rows.value = [];
    send({ type: "subscribe", items: [activeTopic.value] });
  }

  function watchCurrentRange() {
    const ids = rows.value.map(eventIdOf);
    if (!ids.length) return;
    send({
      type: "watch_collection_range",
      item: activeTopic.value,
      loadedIds: ids,
      visibleIds: ids.slice(0, 16),
      pageNum: 1,
      pageSize: 50,
    });
  }

  function connect() {
    if (socket || stopped) return;
    status.value = reconnectAttempt ? "reconnecting" : "connecting";
    const nextSocket = new WebSocket(endpoint);
    socket = nextSocket;

    nextSocket.onopen = () => {
      if (socket !== nextSocket) return;
      status.value = "connected";
      reconnectAttempt = 0;
      addLog("open", 0, endpoint, undefined, "neutral");
      subscribe();
    };

    nextSocket.onmessage = (event) => {
      if (socket !== nextSocket || typeof event.data !== "string") return;
      handleMessage(event.data);
    };

    nextSocket.onerror = () => {
      addLog("transport", 0, "WebSocket transport error", undefined, "warning");
    };

    nextSocket.onclose = (event) => {
      if (socket !== nextSocket) return;
      socket = null;
      status.value = "offline";
      addLog(
        "close",
        0,
        `${event.code} ${event.reason || "connection closed"}`,
        undefined,
        "warning",
      );
      scheduleReconnect();
    };
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer != null) return;
    const delay = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** reconnectAttempt,
    );
    reconnectAttempt += 1;
    status.value = "reconnecting";
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function checkSequence(message: RecordValue): boolean {
    const seq = numberValue(message.seq);
    if (seq == null) return true;
    const incomingStreamId = text(message.streamId);
    if (incomingStreamId && incomingStreamId !== streamId.value) {
      streamId.value = incomingStreamId;
      currentSeq.value = 0;
    }
    if (currentSeq.value && seq <= currentSeq.value) return false;
    if (currentSeq.value && seq > currentSeq.value + 1) {
      stats.gaps += 1;
      addLog(
        "seq_gap",
        0,
        `expected ${currentSeq.value + 1}, received ${seq}; requesting resync`,
        seq,
        "warning",
      );
      send({
        type: "resync",
        items: [activeTopic.value],
        reason: "seq_gap",
      });
      return false;
    }
    currentSeq.value = seq;
    return true;
  }

  function registerRows(values: unknown[]): number {
    const nextRows = values.map(unwrapRow).filter((row): row is BoardRow => row != null);
    if (!nextRows.length) return 0;
    const current = new Map(rows.value.map((row) => [eventIdOf(row), row]));
    for (const row of nextRows) {
      const previous = current.get(eventIdOf(row));
      current.set(eventIdOf(row), previous ? { ...previous, ...row } : row);
      if (row.sportCode) {
        knownSports.set(row.sportCode, row.sportLabel || row.sportCode);
      }
    }
    rows.value = Array.from(current.values());
    return nextRows.length;
  }

  function orderRows(ids: unknown[]) {
    const current = new Map(rows.value.map((row) => [eventIdOf(row), row]));
    const ordered = ids.map(text).map((id) => current.get(id)).filter((row): row is BoardRow => Boolean(row));
    rows.value = ordered;
  }

  function applyTopicOps(ops: unknown[]) {
    for (const value of ops) {
      if (!isRecord(value)) continue;
      const op = text(value.op);
      if (op === "replace_collection" && Array.isArray(value.ids)) {
        orderRows(value.ids);
      } else if (op === "remove_item") {
        const id = text(value.eventId);
        rows.value = rows.value.filter((row) => eventIdOf(row) !== id);
      } else if (op === "insert_item" && value.row) {
        registerRows([value.row]);
        const id = text(value.eventId);
        const index = Math.max(0, numberValue(value.index) ?? rows.value.length);
        const row = rows.value.find((entry) => eventIdOf(entry) === id);
        if (row) {
          rows.value = rows.value.filter((entry) => eventIdOf(entry) !== id);
          rows.value.splice(index, 0, row);
        }
      } else if (op === "patch_item_meta") {
        if (value.row) registerRows([value.row]);
        const id = text(value.eventId);
        const row = rows.value.find((entry) => eventIdOf(entry) === id);
        if (row && isRecord(value.meta)) Object.assign(row, value.meta);
      } else if (op === "patch_event_status") {
        const id = text(value.eventId);
        const row = rows.value.find((entry) => eventIdOf(entry) === id);
        if (row) {
          if (isRecord(value.score)) {
            const home = numberValue(value.score.home);
            const away = numberValue(value.score.away);
            if (home != null && away != null) row.score = `${home} - ${away}`;
          } else if (value.score != null) {
            row.score = String(value.score);
          }
          if (value.clock != null) row.livePhase = String(value.clock);
          if (value.status != null) row.matchStatus = String(value.status);
        }
      }
    }
  }

  function flashKey(eventId: string, market: MarketCell): string {
    return `${eventId}|${marketIdentity(market)}`;
  }

  function setFlash(key: string, trend: Trend) {
    flashes[key] = trend;
    window.setTimeout(() => {
      if (flashes[key] === trend) delete flashes[key];
    }, 900);
  }

  function normalizeChanges(message: RecordValue): RecordValue[] {
    const direct = Array.isArray(message.changes)
      ? message.changes
      : Array.isArray(message.outcomeChanges)
        ? message.outcomeChanges
        : [];
    const changes = direct.filter(isRecord);
    if (!Array.isArray(message.changesByEvent) || !Array.isArray(message.fields)) {
      return changes;
    }
    const fields = message.fields.map(text);
    for (const eventGroup of message.changesByEvent) {
      if (!isRecord(eventGroup) || !Array.isArray(eventGroup.markets)) continue;
      for (const marketGroup of eventGroup.markets) {
        if (!isRecord(marketGroup) || !Array.isArray(marketGroup.outcomes)) continue;
        for (const tuple of marketGroup.outcomes) {
          if (!Array.isArray(tuple)) continue;
          const change: RecordValue = {
            eventId: eventGroup.eventId,
            sourceMarketKey: marketGroup.sourceMarketKey,
          };
          fields.forEach((field, index) => {
            if (field) change[field] = tuple[index];
          });
          changes.push(change);
        }
      }
    }
    return changes;
  }

  function applyOutcomeChanges(message: RecordValue): number {
    let applied = 0;
    for (const change of normalizeChanges(message)) {
      const eventId = text(change.eventId);
      const sourceMarketKey = text(change.sourceMarketKey);
      const sourceOutcomeCode = text(change.sourceOutcomeCode);
      const row = rows.value.find((entry) => eventIdOf(entry) === eventId);
      if (!row) continue;
      const market = row.markets.find(
        (entry) =>
          text(entry.sourceMarketKey) === sourceMarketKey &&
          text(entry.sourceOutcomeCode || entry.key) === sourceOutcomeCode,
      );
      if (!market) continue;
      const next = numberValue(change.odds ?? change.oddsDecimal);
      const previous = market.value;
      if (next != null && next > 0 && next !== previous) {
        market.value = next;
        const explicitTrend = text(change.trend).toLowerCase();
        const trend: Trend =
          explicitTrend === "up" || explicitTrend === "down"
            ? explicitTrend
            : next > previous
              ? "up"
              : "down";
        market.trend = trend;
        setFlash(flashKey(eventId, market), trend);
        applied += 1;
      }
      if (typeof change.locked === "boolean") market.locked = change.locked;
      if (change.providerVersion != null) market.providerVersion = String(change.providerVersion);
      if (change.updatedAt != null) market.oddsUpdatedAt = String(change.updatedAt);
    }
    if (applied) rows.value = [...rows.value];
    stats.oddsPatches += applied;
    return applied;
  }

  function handleMessage(raw: string) {
    const bytes = new TextEncoder().encode(raw).byteLength;
    stats.messages += 1;
    stats.bytes += bytes;
    let message: RecordValue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed)) throw new Error("message is not an object");
      message = parsed;
    } catch {
      addLog("invalid", bytes, "Malformed JSON message", undefined, "warning");
      return;
    }

    const type = text(message.type) || "unknown";
    const seq = numberValue(message.seq);
    if (type === "topic_snapshot") {
      const incomingStreamId = text(message.streamId);
      if (incomingStreamId) streamId.value = incomingStreamId;
      currentSeq.value = seq ?? currentSeq.value;
    } else if (["topic_delta", "outcome_delta"].includes(type)) {
      if (!checkSequence(message)) return;
    }

    if (type === "ready") {
      streamId.value = text(message.streamId) || streamId.value;
      addLog("ready", bytes, `protocol ${text(message.protocolVersion) || PROTOCOL_VERSION}`, undefined, "neutral");
      return;
    }

    if (type === "topic_snapshot") {
      stats.snapshots += 1;
      const count = registerRows(Array.isArray(message.rows) ? message.rows : []);
      if (isRecord(message.collection) && Array.isArray(message.collection.ids)) {
        orderRows(message.collection.ids);
      }
      applyOutcomeChanges(isRecord(message.entities) ? message.entities : {});
      addLog(type, bytes, `${count} baseline rows`, seq, "snapshot");
      watchCurrentRange();
      return;
    }

    if (type === "topic_delta") {
      stats.topicDeltas += 1;
      const seeded = registerRows(Array.isArray(message.rows) ? message.rows : []);
      const ops = Array.isArray(message.ops) ? message.ops : [];
      applyTopicOps(ops);
      const odds = applyOutcomeChanges(message);
      addLog(type, bytes, `${ops.length} ops / ${seeded} rows / ${odds} odds`, seq, "delta");
      watchCurrentRange();
      return;
    }

    if (type === "outcome_delta") {
      stats.outcomeDeltas += 1;
      const odds = applyOutcomeChanges(message);
      addLog(type, bytes, `${odds} odds patches`, seq, "odds");
      return;
    }

    if (type === "heartbeat") {
      addLog(type, bytes, "server heartbeat", undefined, "neutral");
      return;
    }

    addLog(type, bytes, text(message.message) || "control message", seq, type === "error" ? "warning" : "neutral");
  }

  function updateTopic(patch: Partial<TopicItem>) {
    const previous = activeTopic.value;
    if (socket?.readyState === WebSocket.OPEN) {
      send({ type: "unsubscribe", items: [previous] });
    }
    activeTopic.value = { ...previous, ...patch };
    if (socket?.readyState === WebSocket.OPEN) subscribe();
  }

  function reconnect() {
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt = 0;
    socket?.close(1000, "manual reconnect");
    socket = null;
    stopped = false;
    connect();
  }

  function clearLogs() {
    logs.value = [];
  }

  function resetStats() {
    Object.assign(stats, {
      messages: 0,
      bytes: 0,
      snapshots: 0,
      topicDeltas: 0,
      outcomeDeltas: 0,
      oddsPatches: 0,
      gaps: 0,
    });
  }

  connect();
  onBeforeUnmount(() => {
    stopped = true;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    socket?.close(1000, "view disposed");
    socket = null;
  });

  return {
    activeTopic,
    clearLogs,
    currentSeq,
    endpoint,
    flashes,
    formatBytes,
    groups,
    lastMessageAt,
    logs,
    reconnect,
    resetStats,
    rows,
    sportOptions,
    stats,
    status,
    streamId,
    topicKey: computed(() => topicKey(activeTopic.value)),
    updateTopic,
  };
}
