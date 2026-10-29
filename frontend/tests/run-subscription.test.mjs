import assert from "node:assert/strict";
import { sleep } from "bun";
import { test } from "bun:test";
import { subscribeToRunUpdates } from "../src/components/workspace/run-subscription.ts";

function subscriptionHarness(refresh) {
  let callbacks;
  let closed = false;
  const cleanup = subscribeToRunUpdates(
    "run-id",
    refresh,
    (_input, observer) => {
      callbacks = observer;
      return {
        unsubscribe() {
          closed = true;
          // Native httpSubscriptionLink completes the observer during teardown.
          observer.onComplete();
        },
      };
    },
  );
  return { cleanup, callbacks, isClosed: () => closed };
}

test("run subscription teardown cancels pending refreshes and ignores completion during unsubscribe", async () => {
  let refreshes = 0;
  const harness = subscriptionHarness(async () => {
    refreshes++;
  });
  harness.callbacks.onData({ sequence: 1 });
  harness.cleanup();
  harness.callbacks.onError(new Error("Late connection event"));
  harness.callbacks.onData({ sequence: 2 });
  await sleep(450);
  assert.equal(harness.isClosed(), true);
  assert.equal(refreshes, 0);
});

test("run completion refreshes once and replaces an outstanding event refresh", async () => {
  let refreshes = 0;
  const harness = subscriptionHarness(async () => {
    refreshes++;
  });
  try {
    harness.callbacks.onData({ sequence: 1 });
    harness.callbacks.onComplete();
    await sleep(450);
    assert.equal(refreshes, 1);
  } finally {
    harness.cleanup();
  }
  assert.equal(refreshes, 1);
});
