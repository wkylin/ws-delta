import type { BoardRow, MarketCell } from "./types";

function eventIdOf(row: BoardRow): string {
  return row.eventId || row.id;
}

export function outcomeIdentity(
  eventId: string,
  sourceMarketKey: string,
  sourceOutcomeCode: string,
): string {
  return JSON.stringify([eventId, sourceMarketKey, sourceOutcomeCode]);
}

export class BoardLookupIndex {
  private readonly rowsById = new Map<string, BoardRow>();
  private readonly marketsByIdentity = new Map<string, MarketCell>();

  rebuild(rows: BoardRow[]): void {
    this.rowsById.clear();
    this.marketsByIdentity.clear();

    for (const row of rows) {
      const eventId = eventIdOf(row);
      this.rowsById.set(eventId, row);
      for (const market of row.markets) {
        this.marketsByIdentity.set(
          outcomeIdentity(
            eventId,
            market.sourceMarketKey || "",
            market.sourceOutcomeCode || market.key,
          ),
          market,
        );
      }
    }
  }

  row(eventId: string): BoardRow | undefined {
    return this.rowsById.get(eventId);
  }

  market(
    eventId: string,
    sourceMarketKey: string,
    sourceOutcomeCode: string,
  ): MarketCell | undefined {
    return this.marketsByIdentity.get(
      outcomeIdentity(eventId, sourceMarketKey, sourceOutcomeCode),
    );
  }
}
