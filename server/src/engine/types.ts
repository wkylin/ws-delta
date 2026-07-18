import type WebSocket from "ws";
import type { ConnectionRangeState, TopicItem } from "../protocol";

export interface MockRealtimeConfig {
  wsPath: string;
  heartbeatMs: number;
  maxClientMessageBytes: number;
  maxServerMessageBytes: number;
  allowedOrigins: string[];
  allowMissingOrigin: boolean;
  requireHello: boolean;
  helloTimeoutMs: number;
  authToken?: string;
  maxSubscriptionsPerConnection: number;
  maxTopicsPerMessage: number;
  maxRangeIds: number;
  maxNotificationAcks: number;
  pingIntervalMs: number;
  bufferedAmountHighWaterBytes: number;
  bufferedAmountCloseBytes: number;
  maxRecoverableDrops: number;
  instanceId: string;
  distributed: {
    redisUrl?: string;
    kafkaBrokers: string[];
    kafkaTopic: string;
    kafkaGroupId: string;
    channel: string;
    snapshotTtlSeconds: number;
  };
}

export interface BoardMarket {
  key: string;
  label: string;
  value: number;
  sourceMarketKey: string;
  sourceOutcomeCode: string;
  locked: boolean;
  providerVersion: number;
  oddsUpdatedAt: string;
}

export interface BoardMatch {
  eventId: string;
  sportCode: string;
  sportLabel: string;
  countryName: string;
  tournamentName: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  livePhase: string;
  isLive: boolean;
  score: { home: number; away: number };
  rank: number;
  markets: BoardMarket[];
}

export interface ConnectionState {
  id: string;
  ws: WebSocket;
  helloReceived: boolean;
  authenticated: boolean;
  helloTimeoutTimer: NodeJS.Timeout | null;
  subscribedTopics: Map<string, TopicItem>;
  ranges: Map<string, ConnectionRangeState>;
  isAlive: boolean;
  droppedRecoverableMessages: number;
  backpressureNotified: boolean;
}
