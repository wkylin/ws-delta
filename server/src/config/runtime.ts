import path from "node:path";
import { fileURLToPath } from "node:url";
import type { MockRealtimeConfig } from "../engine";

export interface RuntimeConfig {
  host: string;
  port: number;
  engine: MockRealtimeConfig;
}

function numEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return Array.from(
    new Set(
      raw
        .split(",")
        .map((entry) => entry.trim())
        .filter((entry) => Boolean(entry) && entry !== "*"),
    ),
  );
}

export function loadRuntimeConfig(): RuntimeConfig {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const serverRoot = path.resolve(here, "../../..");
  try {
    process.loadEnvFile(path.join(serverRoot, ".env"));
  } catch {
    // Optional for the mock server.
  }

  const heartbeatMs = Math.max(
    0,
    numEnv("MOCK_REALTIME_HEARTBEAT_MS", 15_000),
  );
  const legacyMaxMessageBytes = Math.max(
    1_024,
    numEnv("MOCK_REALTIME_MAX_MESSAGE_BYTES", 16_777_216),
  );
  const maxServerMessageBytes = Math.max(
    1_024,
    numEnv("MOCK_REALTIME_MAX_SERVER_MESSAGE_BYTES", legacyMaxMessageBytes),
  );
  const bufferedAmountHighWaterBytes = Math.max(
    maxServerMessageBytes,
    numEnv("MOCK_REALTIME_BUFFER_HIGH_WATER_BYTES", 67_108_864),
  );
  const instanceId = process.env.MOCK_REALTIME_INSTANCE_ID?.trim() || `ws_${process.pid}`;
  const kafkaGroupPrefix = process.env.MOCK_REALTIME_KAFKA_GROUP_ID?.trim() || "sports-realtime-gateway";

  return {
    host: process.env.MOCK_REALTIME_HOST?.trim() || "0.0.0.0",
    port: numEnv("MOCK_REALTIME_PORT", 8088),
    engine: {
      wsPath: "/gateway/ws/stream",
      heartbeatMs,
      maxClientMessageBytes: Math.max(
        1_024,
        numEnv("MOCK_REALTIME_MAX_CLIENT_MESSAGE_BYTES", legacyMaxMessageBytes),
      ),
      maxServerMessageBytes,
      allowedOrigins: csvEnv("MOCK_REALTIME_ALLOWED_ORIGINS", [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
      ]),
      allowMissingOrigin: boolEnv("MOCK_REALTIME_ALLOW_MISSING_ORIGIN", true),
      requireHello: boolEnv("MOCK_REALTIME_REQUIRE_HELLO", false),
      helloTimeoutMs: Math.max(
        1,
        numEnv("MOCK_REALTIME_HELLO_TIMEOUT_MS", 5_000),
      ),
      authToken: process.env.MOCK_REALTIME_TOKEN?.trim() || undefined,
      maxSubscriptionsPerConnection: Math.max(
        1,
        numEnv("MOCK_REALTIME_MAX_SUBSCRIPTIONS", 256),
      ),
      maxTopicsPerMessage: Math.max(
        1,
        numEnv("MOCK_REALTIME_MAX_TOPICS_PER_MESSAGE", 256),
      ),
      maxRangeIds: Math.max(1, numEnv("MOCK_REALTIME_MAX_RANGE_IDS", 2_000)),
      maxNotificationAcks: Math.max(
        1,
        numEnv("MOCK_REALTIME_MAX_NOTIFICATION_ACKS", 10_000),
      ),
      pingIntervalMs: Math.max(
        1_000,
        numEnv("MOCK_REALTIME_PING_INTERVAL_MS", 15_000),
      ),
      bufferedAmountHighWaterBytes,
      bufferedAmountCloseBytes: Math.max(
        bufferedAmountHighWaterBytes + maxServerMessageBytes,
        numEnv("MOCK_REALTIME_BUFFER_CLOSE_BYTES", 268_435_456),
      ),
      maxRecoverableDrops: Math.max(
        1,
        numEnv("MOCK_REALTIME_MAX_RECOVERABLE_DROPS", 200),
      ),
      instanceId,
      distributed: {
        redisUrl: process.env.MOCK_REALTIME_REDIS_URL?.trim() || undefined,
        kafkaBrokers: csvEnv("MOCK_REALTIME_KAFKA_BROKERS", []),
        kafkaTopic: process.env.MOCK_REALTIME_KAFKA_TOPIC?.trim() || "sports.realtime.events",
        // Every gateway instance needs its own group so Kafka broadcasts to all instances.
        kafkaGroupId: `${kafkaGroupPrefix}-${instanceId}`,
        channel: process.env.MOCK_REALTIME_REDIS_CHANNEL?.trim() || "sports:realtime:events",
        snapshotTtlSeconds: Math.max(1, numEnv("MOCK_REALTIME_SNAPSHOT_TTL_SECONDS", 30)),
      },
    },
  };
}
