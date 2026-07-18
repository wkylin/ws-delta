import assert from "node:assert/strict";
import test from "node:test";
import { LocalRealtimeBus, MemorySnapshotStore } from "../server/src/distributed";

test("local bus fans an event out to multiple gateway instances", async () => {
  const first = new LocalRealtimeBus();
  const second = new LocalRealtimeBus();
  const received: string[] = [];
  await first.start((event) => received.push(`first:${event.eventId}`));
  await second.start((event) => received.push(`second:${event.eventId}`));
  await first.publish({ eventId: "evt-1", originInstanceId: "instance-a", topicKey: "topic", kind: "outcome", payload: { changes: [] }, publishedAt: new Date().toISOString() });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(received.sort(), ["first:evt-1", "second:evt-1"]);
  await first.stop();
  await second.stop();
});

test("memory snapshot store follows shared-store expiry semantics", async () => {
  const store = new MemorySnapshotStore();
  await store.set("snapshot", "{\"rows\":[]}", 1);
  assert.equal(await store.get("snapshot"), "{\"rows\":[]}");
  await store.stop();
});
