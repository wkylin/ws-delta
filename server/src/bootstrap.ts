import http from "node:http";
import Router from "@koa/router";
import bodyParser from "koa-bodyparser";
import Koa from "koa";
import { loadRuntimeConfig } from "./config/runtime";
import { MockRealtimeEngine } from "./engine";
import { createHttpMiddleware } from "./http/middleware";
import { createRouter } from "./http/routes";

export function startServer(): void {
  const config = loadRuntimeConfig();
  const engine = new MockRealtimeEngine(config.engine);
  const app = new Koa();
  const router: Router = createRouter({
    engine,
    host: config.host,
    port: config.port,
    heartbeatMs: config.engine.heartbeatMs,
    requireHello: config.engine.requireHello,
    wsPath: config.engine.wsPath,
  });

  app.use(createHttpMiddleware(config.engine.allowedOrigins));
  app.use(bodyParser({ enableTypes: ["json"] }));
  app.use(router.routes());
  app.use(router.allowedMethods());

  const server = http.createServer(app.callback());
  engine.attach(server);
  engine.start();
  server.listen(config.port, config.host, () => {
    console.log(
      `[mock-realtime] listening on http://${config.host}:${config.port} (ws path ${config.engine.wsPath}, heartbeat ${config.engine.heartbeatMs}ms)`,
    );
  });

  const stop = () => {
    engine.stop();
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}