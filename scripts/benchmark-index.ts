import { performance } from "node:perf_hooks";
import { BoardLookupIndex } from "../frontend/src/boardLookupIndex";
import type { BoardRow } from "../frontend/src/types";

const rowCount = 2_000;
const lookups = 20_000;
const rows: BoardRow[] = Array.from({ length: rowCount }, (_, rowIndex) => ({
  id: `event-${rowIndex}`,
  eventId: `event-${rowIndex}`,
  homeTeam: "Home",
  awayTeam: "Away",
  markets: Array.from({ length: 12 }, (_, marketIndex) => ({
    key: `outcome-${marketIndex}`,
    label: "Outcome",
    value: 1.5 + marketIndex / 10,
    sourceMarketKey: "1x2",
    sourceOutcomeCode: `O${marketIndex}`,
  })),
}));

const keys = Array.from({ length: lookups }, (_, index) => ({
  eventId: `event-${index % rowCount}`,
  sourceOutcomeCode: `O${index % 12}`,
}));
const index = new BoardLookupIndex();
index.rebuild(rows);

function measure(run: () => number): { milliseconds: number; checksum: number } {
  const start = performance.now();
  const checksum = run();
  return { milliseconds: performance.now() - start, checksum };
}

const linear = measure(() => keys.reduce((sum, key) => {
  const row = rows.find((candidate) => candidate.eventId === key.eventId);
  const market = row?.markets.find((candidate) => candidate.sourceOutcomeCode === key.sourceOutcomeCode);
  return sum + (market?.value ?? 0);
}, 0));
const indexed = measure(() => keys.reduce(
  (sum, key) => sum + (index.market(key.eventId, "1x2", key.sourceOutcomeCode)?.value ?? 0),
  0,
));

if (Math.abs(linear.checksum - indexed.checksum) > 0.001) {
  throw new Error("benchmark lookup checksums diverged");
}

console.log(JSON.stringify({
  rows: rowCount,
  marketsPerRow: 12,
  lookups,
  linearMs: Number(linear.milliseconds.toFixed(2)),
  indexedMs: Number(indexed.milliseconds.toFixed(2)),
  speedup: Number((linear.milliseconds / indexed.milliseconds).toFixed(2)),
}, null, 2));
