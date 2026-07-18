import assert from "node:assert/strict";
import test from "node:test";
import { BoardLookupIndex, outcomeIdentity } from "../frontend/src/boardLookupIndex";
import type { BoardRow } from "../frontend/src/types";

function row(id: string, value: number): BoardRow {
  return {
    id,
    eventId: id,
    homeTeam: "Home",
    awayTeam: "Away",
    markets: [{
      key: "home",
      label: "Home",
      value,
      sourceMarketKey: "1x2",
      sourceOutcomeCode: "H",
    }],
  };
}

test("indexes rows and outcomes by stable composite identity", () => {
  const index = new BoardLookupIndex();
  const first = row("event-1", 1.8);
  index.rebuild([first]);

  assert.equal(index.row("event-1"), first);
  assert.equal(index.market("event-1", "1x2", "H"), first.markets[0]);
  assert.equal(index.market("event-1", "1x2", "A"), undefined);
  assert.equal(outcomeIdentity("event-1", "1x2", "H"), '["event-1","1x2","H"]');
});

test("rebuild removes stale rows and outcome keys", () => {
  const index = new BoardLookupIndex();
  const first = row("event-1", 1.8);
  index.rebuild([first]);
  const second = row("event-2", 2.2);
  index.rebuild([second]);

  assert.equal(index.row("event-1"), undefined);
  assert.equal(index.market("event-1", "1x2", "H"), undefined);
  assert.equal(index.market("event-2", "1x2", "H"), second.markets[0]);
});
