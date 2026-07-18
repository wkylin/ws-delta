import assert from "node:assert/strict";
import test from "node:test";
import { decideSend } from "../server/src/engine/backpressure";

const limits = { bufferedAmountHighWaterBytes: 100, bufferedAmountCloseBytes: 200 };

test("backpressure keeps structural frames and drops recoverable frames", () => {
  assert.equal(decideSend(99, 1, true, limits), "drop_recoverable");
  assert.equal(decideSend(99, 1, false, limits), "send");
  assert.equal(decideSend(199, 1, true, limits), "close_slow_consumer");
  assert.equal(decideSend(0, 99, true, limits), "send");
});
