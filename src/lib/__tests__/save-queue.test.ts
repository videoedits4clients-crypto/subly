/**
 * Regression tests for createSingleFlightQueue (src/lib/save-queue.ts) — the mechanism that
 * fixes a confirmed stale-PATCH-overwrites-newer-edit race in the editor's autosave (see
 * hooks/use-autosave.ts and research/p1_editor_state_persistence_undo_redo_report.md).
 *
 * Run with: node --test src/lib/__tests__/save-queue.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createSingleFlightQueue } from "../save-queue.ts";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("1. a single run() call executes the task exactly once", async () => {
  let calls = 0;
  const run = createSingleFlightQueue(async () => {
    calls += 1;
  });
  run();
  await delay(10);
  assert.equal(calls, 1);
});

test("2. calling run() again while the task is already in flight does not start a second, overlapping call", async () => {
  let concurrent = 0;
  let maxConcurrent = 0;
  const run = createSingleFlightQueue(async () => {
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    await delay(20);
    concurrent -= 1;
  });
  run();
  run(); // while the first is still in flight
  run(); // and again
  await delay(80);
  assert.equal(maxConcurrent, 1, "two task() calls ran concurrently — the exact race this queue exists to prevent");
});

test("3. multiple run() calls while busy coalesce into exactly ONE follow-up call, not one per run()", async () => {
  let calls = 0;
  const run = createSingleFlightQueue(async () => {
    calls += 1;
    await delay(15);
  });
  run(); // starts immediately
  run(); // queued
  run(); // still just one queued follow-up
  run();
  await delay(100);
  assert.equal(calls, 2, "expected exactly one initial call + one coalesced follow-up");
});

test("4. the queued follow-up call reads whatever is current at the time it actually runs, not a stale snapshot from when run() was called", async () => {
  let latestIntent = "a";
  const applied: string[] = [];
  const run = createSingleFlightQueue(async () => {
    const value = latestIntent; // simulates reading fresh state via getState() inside save()
    await delay(15);
    applied.push(value);
  });
  run(); // will read "a"
  latestIntent = "b";
  run(); // queued — but by the time it actually runs, intent has moved on again
  latestIntent = "c";
  await delay(100);
  assert.deepEqual(applied, ["a", "c"], "the coalesced follow-up should apply the LATEST intent, not an intermediate one");
});

test("5. THE BUG THIS FIXES: two independent (unguarded) concurrent calls can apply out of order and silently lose the newer write — reproduced directly, without the queue, to document exactly what createSingleFlightQueue prevents", async () => {
  // This mirrors use-autosave.ts's ORIGINAL shape: every dirty change scheduled its own
  // independent save() with no in-flight guard. Two such calls are simulated here with the
  // OLDER one (built from earlier state) deliberately resolving AFTER the newer one — which
  // `fetch`/HTTP makes no promise against.
  let serverState = "";
  async function unguardedSave(value: string, artificialDelayMs: number) {
    await delay(artificialDelayMs);
    serverState = value; // last write wins — whichever call's response lands last
  }
  // Older edit fires first but is artificially slower (e.g. a retried/contended request);
  // newer edit fires slightly later but completes first.
  const older = unguardedSave("Hello world", 40);
  const newer = unguardedSave("Hello world this is SUBLY", 10);
  await Promise.all([older, newer]);
  assert.equal(serverState, "Hello world", "demonstrates the bug: the stale, older edit ends up as the final database state");
});

test("6. THE FIX: the same scenario, routed through createSingleFlightQueue, never lets the two calls overlap, so the final database state is always the latest edit", async () => {
  let serverState = "";
  let latestIntent = "";
  const run = createSingleFlightQueue(async () => {
    const value = latestIntent;
    // Simulate the FIRST call being slow — with the queue, there is no "first/second call"
    // race to begin with, since the second run() while busy just gets coalesced.
    await delay(value === "Hello world" ? 40 : 10);
    serverState = value;
  });

  latestIntent = "Hello world";
  run();
  await delay(1); // let the first call actually start (enter "running")
  latestIntent = "Hello world this is SUBLY";
  run(); // arrives while busy — coalesced, will read "Hello world this is SUBLY" when it runs

  await delay(120);
  assert.equal(serverState, "Hello world this is SUBLY", "the final database state must be the latest edit, regardless of network timing");
});

test("7. a failing task does not wedge the queue — a later run() after a rejection still executes", async () => {
  let attempt = 0;
  const run = createSingleFlightQueue(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("simulated network failure");
  });
  run();
  await delay(10);
  assert.equal(attempt, 1);
  run();
  await delay(10);
  assert.equal(attempt, 2);
});

test("8. run() called while idle (nothing in flight, nothing queued) always executes immediately, never dropped", async () => {
  let calls = 0;
  const run = createSingleFlightQueue(async () => {
    calls += 1;
    await delay(5);
  });
  run();
  await delay(20);
  run();
  await delay(20);
  assert.equal(calls, 2);
});
