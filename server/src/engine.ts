import type { Server } from "node:http";
import type { Context } from "koa";
import {
  REALTIME_PROTOCOL_VERSION,
  isRecord,
  normalizeText,
  normalizeTopicItem,
  nowIso,
} from "./protocol";
import { BoardStore } from "./engine/boardStore";
import type { MockRealtimeConfig } from "./engine/types";
import { WsGateway } from "./engine/wsGateway";

export type { MockRealtimeConfig } from "./engine/types";

/** Coordinates board data, the retained HTTP surface, and the WS gateway. */
export class MockRealtimeEngine {
  private readonly board = new BoardStore();
  private readonly gateway: WsGateway;

  constructor(private readonly config: MockRealtimeConfig) {
    this.gateway = new WsGateway(config, this.board);
  }

  attach(server: Server): void { this.gateway.attach(server); }
  start(): void { this.gateway.start(); }
  stop(): void { this.gateway.stop(); }

  handleHealth(ctx: Context): void {
    ctx.body = {
      ok: true,
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      heartbeatMs: this.config.heartbeatMs,
      connections: this.gateway.connectionCount(),
      topicsTracked: this.gateway.topicCount(),
      distributedMode: this.gateway.distributedMode(),
      metrics: this.gateway.metricsSnapshot(),
      serverTime: nowIso(),
    };
  }

  async handleMetrics(ctx: Context): Promise<void> {
    ctx.type = "text/plain; version=0.0.4; charset=utf-8";
    ctx.body = await this.gateway.prometheusMetrics();
  }

  handleDebugState(ctx: Context): void {
    ctx.body = {
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      serverTime: nowIso(),
      heartbeatMs: this.config.heartbeatMs,
      connections: this.gateway.debugConnections(),
      ...this.board.debug(),
    };
  }

  handleDebugHomeBoardQuery(ctx: Context): void {
    const item = this.topicFromQuery(ctx);
    ctx.body = { ...this.board.httpBoard(item), debug: { item } };
  }

  handleHomeMainBoardHttp(ctx: Context): void { ctx.body = this.board.httpBoard(this.topicFromQuery(ctx)); }
  handleHomeMainBoardSportsHttp(ctx: Context): void { this.emptyHttp(ctx, "home board controls are provided by the realtime snapshot"); }
  handleHomeMainBoardFiltersHttp(ctx: Context): void { this.emptyHttp(ctx, "home board controls are provided by the realtime snapshot"); }
  handleHomeMainBoardContentHttp(ctx: Context): void { ctx.body = this.board.httpBoard(this.topicFromQuery(ctx)); }

  // These routes remain valid without keeping their retired realtime topics alive.
  handleAdvertisementsHttp(ctx: Context): void { this.emptyHttp(ctx, "advertisements are not part of the board realtime mock"); }
  handleGameCategoriesHttp(ctx: Context): void { this.emptyHttp(ctx, "categories are not part of the board realtime mock"); }
  handleHomeTopMatchesHttp(ctx: Context): void { this.emptyHttp(ctx, "top matches topic is not supported"); }
  handleLiveSingleViewDetailHttp(ctx: Context): void { this.emptyHttp(ctx, "match detail topic is not supported"); }
  handleLiveNowSidebarHttp(ctx: Context): void { this.emptyHttp(ctx, "live sidebar topic is not supported"); }
  handleEmitTicket(ctx: Context): void { this.emptyHttp(ctx, "ticket topic is not supported"); }
  handleEmitNotification(ctx: Context): void { this.emptyHttp(ctx, "notification topic is not supported"); }

  handleForceSeqGap(ctx: Context): void {
    const body = isRecord(ctx.request.body) ? ctx.request.body : {};
    const item = normalizeTopicItem(body.item);
    const skip = Number(body.skip ?? 1);
    if (!item || !Number.isSafeInteger(skip) || skip < 1 || skip > 1_000_000) {
      ctx.status = 400;
      ctx.body = { error: "invalid_request" };
      return;
    }
    if (!this.gateway.forceSeqGap(item, skip)) {
      ctx.status = 409;
      ctx.body = { error: "topic_not_subscribed" };
      return;
    }
    ctx.body = { ok: true, skip };
  }

  handleBackpressure(ctx: Context): void {
    const body = isRecord(ctx.request.body) ? ctx.request.body : {};
    const requested = Number(body.retryAfterMs ?? 2_000);
    if (!Number.isFinite(requested)) {
      ctx.status = 400;
      ctx.body = { error: "invalid_retry_after_ms" };
      return;
    }
    const actions = Array.isArray(body.actions)
      ? body.actions.map((entry) => normalizeText(entry)).filter(Boolean)
      : ["reduce_range"];
    const retryAfterMs = Math.min(300_000, Math.max(500, Math.round(requested)));
    this.gateway.sendBackpressure(retryAfterMs, actions);
    ctx.body = { ok: true, retryAfterMs, actions };
  }

  handleEmitOutcomeBatch(ctx: Context): void {
    const deliveredMessages = this.gateway.emitOutcomeBatch();
    ctx.body = { ok: deliveredMessages > 0, deliveredMessages };
  }

  handleEmitMixedTopicDelta(ctx: Context): void {
    const body = isRecord(ctx.request.body) ? ctx.request.body : {};
    if (body.item !== undefined && !normalizeTopicItem(body.item)) {
      ctx.status = 400;
      ctx.body = { error: "invalid item" };
      return;
    }
    const deliveredMessages = this.gateway.emitCollectionBatch();
    ctx.body = { ok: deliveredMessages > 0, deliveredMessages };
  }

  private topicFromQuery(ctx: Context) {
    return normalizeTopicItem({
      topic: "home.board",
      showScope: this.query(ctx, "showScope", "all"),
      sportCode: this.query(ctx, "sportCode", "all"),
      groupMode: this.query(ctx, "groupMode", "league"),
      primaryMarketTabCode: this.query(ctx, "primaryMarketTabCode", "1x2"),
      pageNum: Number(this.query(ctx, "pageNum", "1")),
      pageSize: Number(this.query(ctx, "pageSize", "50")),
    })!;
  }

  private query(ctx: Context, key: string, fallback: string): string {
    const value = ctx.query[key];
    return normalizeText(Array.isArray(value) ? value[0] : value) || fallback;
  }

  private emptyHttp(ctx: Context, reason: string): void {
    ctx.body = {
      code: "SUCCESS",
      message: "操作成功",
      traceId: "",
      data: { available: false, reason, items: [] },
    };
  }
}
