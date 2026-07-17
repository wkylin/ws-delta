export type ConnectionStatus =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export type Trend = "up" | "down" | "stable";

export interface TopicItem {
  topic: "home.board";
  moduleType: "HOME_MAIN_BOARD";
  siteCode: string;
  showScope: "all" | "live";
  sportCode: string;
  groupMode: "league" | "time";
  primaryMarketTabCode: string;
  pageNum: number;
  pageSize: number;
}

export interface BoardGroup {
  country: string;
  league: string;
  rows: BoardRow[];
}

export interface MarketCell {
  key: string;
  label: string;
  value: number;
  locked?: boolean;
  trend?: Trend;
  sourceMarketKey?: string;
  sourceOutcomeCode?: string;
  providerVersion?: number | string;
  oddsUpdatedAt?: string;
}

export interface BoardRow {
  id: string;
  eventId?: string;
  sportCode?: string;
  sportLabel?: string;
  countryName?: string;
  tournamentName?: string;
  league?: string[];
  homeTeam: string;
  awayTeam: string;
  kickoff?: string;
  livePhase?: string;
  displayStatusText?: string;
  score?: string;
  isLive?: boolean;
  matchStatus?: string;
  marketName?: string;
  markets: MarketCell[];
  extraMarkets?: number;
  rank?: number;
  dataVersion?: number;
}

export interface ProtocolLog {
  id: number;
  time: string;
  type: string;
  seq?: number;
  bytes: number;
  summary: string;
  tone: "neutral" | "snapshot" | "delta" | "odds" | "warning";
}

export interface RealtimeStats {
  messages: number;
  bytes: number;
  snapshots: number;
  topicDeltas: number;
  outcomeDeltas: number;
  oddsPatches: number;
  gaps: number;
}
