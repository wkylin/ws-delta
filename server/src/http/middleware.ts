import type Koa from "koa";
import { isAllowedMockDevelopmentOrigin } from "../devOrigin";
import { REALTIME_PROTOCOL_VERSION } from "../protocol";

const defaultCorsHeaders = [
  "Content-Type",
  "Authorization",
  "Idempotency-Key",
  "Token",
  "My-User-Info",
  "X-Requested-With",
];

export function createHttpMiddleware(allowedOrigins: string[]): Koa.Middleware {
  return async (ctx, next) => {
    const origin = ctx.get("Origin").trim();
    const isAllowedOrigin =
      !origin ||
      allowedOrigins.includes(origin) ||
      isAllowedMockDevelopmentOrigin(origin);

    if (!isAllowedOrigin) {
      ctx.status = 403;
      ctx.body = {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        error: "origin_not_allowed",
      };
      return;
    }
    if (origin) {
      ctx.set("Access-Control-Allow-Origin", origin);
      ctx.set("Access-Control-Allow-Credentials", "true");
    }
    ctx.set("Vary", "Origin");
    ctx.set("Access-Control-Allow-Headers", defaultCorsHeaders.join(", "));
    ctx.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    if (ctx.method === "OPTIONS") {
      ctx.status = 204;
      return;
    }
    try {
      await next();
    } catch (error) {
      console.error("[mock-realtime] request failed", error);
      ctx.status = 500;
      ctx.body = {
        protocolVersion: REALTIME_PROTOCOL_VERSION,
        error: "internal_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  };
}