import Router from "@koa/router";
import type { MockRealtimeEngine } from "../engine";
import { REALTIME_PROTOCOL_VERSION } from "../protocol";

interface RouteOptions {
  engine: MockRealtimeEngine;
  host: string;
  port: number;
  heartbeatMs: number;
  requireHello: boolean;
  wsPath: string;
}

export function createRouter(options: RouteOptions): Router {
  const { engine } = options;
  const router = new Router();

  router.get("/health", (ctx) => engine.handleHealth(ctx));
  router.get("/metrics", (ctx) => engine.handleMetrics(ctx));
  router.get("/api/mock/realtime/state", (ctx) => engine.handleDebugState(ctx));
  router.get("/api/mock/realtime/debug/home-board", (ctx) =>
    engine.handleDebugHomeBoardQuery(ctx),
  );
  router.get("/v1/home/main-board", (ctx) => engine.handleHomeMainBoardHttp(ctx));
  router.post("/api/mock/realtime/controls/seq-gap", (ctx) =>
    engine.handleForceSeqGap(ctx),
  );
  router.post("/api/mock/realtime/controls/backpressure", (ctx) =>
    engine.handleBackpressure(ctx),
  );
  router.post("/api/mock/realtime/emit/outcome-batch", (ctx) =>
    engine.handleEmitOutcomeBatch(ctx),
  );
  router.post("/api/mock/realtime/emit/topic-mixed", (ctx) =>
    engine.handleEmitMixedTopicDelta(ctx),
  );
  router.get("/", (ctx) => {
    ctx.body = {
      name: "structured-realtime-mock",
      protocolVersion: REALTIME_PROTOCOL_VERSION,
      requireHello: options.requireHello,
      heartbeatMs: options.heartbeatMs,
      ws: `ws://${options.host === "0.0.0.0" ? "localhost" : options.host}:${options.port}${options.wsPath}`,
      docs: [
        "GET /v1/home/main-board",
        "GET /health",
        "GET /metrics",
        "GET /api/mock/realtime/state",
        "GET /api/mock/realtime/debug/home-board",
        "POST /api/mock/realtime/controls/seq-gap",
        "POST /api/mock/realtime/controls/backpressure",
        "POST /api/mock/realtime/emit/ticket",
        "POST /api/mock/realtime/emit/notification",
        "POST /api/mock/realtime/emit/outcome-batch",
        "POST /api/mock/realtime/emit/topic-mixed (optional body.item)",
      ],
    };
  });

  return router;
}
