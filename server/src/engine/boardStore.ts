import { normalizeText, nowIso, type ConnectionRangeState, type HomeBoardTopicItem } from "../protocol";
import type { BoardMatch, BoardMarket } from "./types";

const MAX_SNAPSHOT_ROWS = 50;

const seed = [
  ["football", "Football", "England", "Premier League", "Northbridge FC", "Riverside United", true],
  ["football", "Football", "Spain", "La Liga", "Real Sol", "Atletico Verde", true],
  ["basketball", "Basketball", "United States", "Pro League", "Metro Kings", "Harbor Waves", false],
  ["tennis", "Tennis", "International", "Hard Court Series", "A. Morgan", "L. Chen", false],
  ["football", "Football", "Germany", "Bundesliga", "Berlin 04", "Rhine Athletic", false],
  ["basketball", "Basketball", "Australia", "National League", "Sydney Comets", "Melbourne Orbit", true],
] as const;

export class BoardStore {
  private readonly matches = new Map<string, BoardMatch>();
  private version = 1;

  constructor() {
    seed.forEach(([sportCode, sportLabel, countryName, tournamentName, homeTeam, awayTeam, isLive], index) => {
      const eventId = `board:${index + 1}`;
      this.matches.set(eventId, {
        eventId,
        sportCode,
        sportLabel,
        countryName,
        tournamentName,
        homeTeam,
        awayTeam,
        kickoff: new Date(Date.now() + (index + 1) * 3_600_000).toISOString(),
        livePhase: isLive ? `${12 + index}'` : "",
        isLive,
        score: { home: isLive ? index % 3 : 0, away: isLive ? (index + 1) % 3 : 0 },
        rank: index + 1,
        markets: this.createMarkets(index),
      });
    });
  }

  list(item: HomeBoardTopicItem): BoardMatch[] {
    const sportCode = normalizeText(item.sportCode);
    const showScope = normalizeText(item.showScope).toLowerCase();
    return Array.from(this.matches.values())
      .filter((match) => !sportCode || sportCode === "all" || match.sportCode === sportCode)
      .filter((match) => showScope !== "live" || match.isLive)
      .sort((left, right) => item.groupMode === "time"
        ? left.kickoff.localeCompare(right.kickoff)
        : left.rank - right.rank);
  }

  snapshotRows(item: HomeBoardTopicItem, range?: ConnectionRangeState): Record<string, unknown>[] {
    const known = new Set(this.matches.keys());
    const tracked = (range?.visibleIds?.length ? range.visibleIds : range?.loadedIds ?? [])
      .filter((eventId) => known.has(eventId));
    const candidates = tracked.length
      ? tracked.map((eventId) => this.matches.get(eventId)).filter((match): match is BoardMatch => Boolean(match))
      : this.list(item);
    const limit = Math.min(MAX_SNAPSHOT_ROWS, Math.max(1, Math.floor(range?.pageSize ?? item.pageSize ?? 12)));
    return candidates.slice(0, limit).map((match) => this.toRow(match, item));
  }

  knownIds(ids: unknown[]): string[] {
    return ids.map((value) => normalizeText(value)).filter((id) => this.matches.has(id));
  }

  mutateOutcomes(item: HomeBoardTopicItem, ids: string[]): Array<Record<string, unknown>> {
    const selected = (ids.length ? ids.map((id) => this.matches.get(id)) : this.list(item))
      .filter((match): match is BoardMatch => Boolean(match));
    if (!selected.length) return [];
    const changes: Array<Record<string, unknown>> = [];
    for (const match of selected.slice(0, 4)) {
      const market = match.markets[Math.floor(Math.random() * match.markets.length)];
      const previous = market.value;
      const next = Math.max(1.01, Number((previous + (Math.random() < 0.5 ? -0.06 : 0.06)).toFixed(2)));
      market.value = next;
      market.providerVersion = ++this.version;
      market.oddsUpdatedAt = nowIso();
      changes.push({
        eventId: match.eventId,
        sourceMarketKey: market.sourceMarketKey,
        sourceOutcomeCode: market.sourceOutcomeCode,
        oddsDecimal: next.toFixed(2),
        trend: next > previous ? "up" : "down",
        locked: market.locked,
        providerVersion: market.providerVersion,
        updatedAt: market.oddsUpdatedAt,
      });
    }
    return changes;
  }

  statusDelta(item: HomeBoardTopicItem, ids: string[]): { ops: Array<Record<string, unknown>>; ids: string[] } | null {
    const rows = this.snapshotRows(item, ids.length ? { loadedIds: ids, visibleIds: [], pageSize: ids.length } : undefined);
    if (!rows.length) return null;
    const first = rows[0] as { eventId: string };
    const match = this.matches.get(first.eventId);
    if (!match) return null;
    if (match.isLive) {
      match.score.home += Math.random() < 0.25 ? 1 : 0;
      match.livePhase = `${Math.min(90, Number.parseInt(match.livePhase, 10) + 1 || 1)}'`;
    }
    const nextIds = rows.map((row) => String((row as { eventId: string }).eventId));
    return {
      ids: nextIds,
      ops: [
        { op: "patch_event_status", eventId: match.eventId, score: match.score, clock: match.livePhase, status: match.isLive ? "live" : "scheduled" },
        { op: "replace_collection", ids: nextIds },
      ],
    };
  }

  httpBoard(item: HomeBoardTopicItem): Record<string, unknown> {
    const rows = this.snapshotRows(item);
    return { code: "SUCCESS", message: "操作成功", traceId: "", data: { rows, totalRows: this.list(item).length } };
  }

  debug(): Record<string, unknown> {
    return { matches: Array.from(this.matches.values()).map((match) => this.toRow(match, { topic: "home.board" })) };
  }

  private createMarkets(index: number): BoardMarket[] {
    return [["1", "Home"], ["X", "Draw"], ["2", "Away"]].map(([key, label], outcomeIndex) => ({
      key,
      label,
      value: Number((1.45 + ((index + outcomeIndex) % 5) * 0.28).toFixed(2)),
      sourceMarketKey: "1",
      sourceOutcomeCode: `1:${outcomeIndex + 1}`,
      locked: false,
      providerVersion: this.version,
      oddsUpdatedAt: nowIso(),
    }));
  }

  private toRow(match: BoardMatch, item: HomeBoardTopicItem): Record<string, unknown> {
    const preferred = normalizeText(item.primaryMarketTabCode);
    const markets = preferred === "2up" ? match.markets.map((market) => ({ ...market, value: Number((market.value + 0.12).toFixed(2)) })) : match.markets;
    return {
      id: match.eventId, eventId: match.eventId, sportCode: match.sportCode, sportLabel: match.sportLabel,
      countryName: match.countryName, tournamentName: match.tournamentName, homeTeam: match.homeTeam,
      awayTeam: match.awayTeam, kickoff: match.kickoff.slice(11, 16), livePhase: match.livePhase,
      isLive: match.isLive, score: match.isLive ? `${match.score.home} - ${match.score.away}` : "",
      matchStatus: match.isLive ? "live" : "scheduled", marketName: preferred || "1x2", markets, rank: match.rank,
    };
  }
}