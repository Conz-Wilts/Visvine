import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createAutosaveQueue, type SavePatch, type SaveStatus } from '../lib/autosave';

/** Manual fake timers so debounce/retry are deterministic. */
function fakeTimers() {
  let nextId = 1;
  const scheduled = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    timers: {
      setTimeout(fn: () => void, ms: number): unknown {
        const id = nextId++;
        scheduled.set(id, { fn, at: now + ms });
        return id;
      },
      clearTimeout(id: unknown): void {
        scheduled.delete(id as number);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...scheduled.entries()].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          scheduled.delete(id);
          t.fn();
        }
      }
    },
  };
}

/** Flush resolved promise callbacks. */
async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function harness(saveImpl?: (patch: SavePatch) => Promise<void>) {
  const clock = fakeTimers();
  const calls: SavePatch[] = [];
  const statuses: SaveStatus[] = [];
  let fail = false;
  const queue = createAutosaveQueue(
    async (patch) => {
      calls.push(patch);
      if (saveImpl) return saveImpl(patch);
      if (fail) throw new Error('boom');
    },
    { onStatus: (s) => statuses.push(s), timers: clock.timers }
  );
  return { queue, calls, statuses, clock, setFail: (v: boolean) => { fail = v; } };
}

describe('createAutosaveQueue', () => {
  it('sends immediately with no debounce', async () => {
    const h = harness();
    h.queue.queue({ name: 'A' });
    await settle();
    assert.deepEqual(h.calls, [{ name: 'A' }]);
    assert.equal(h.queue.getStatus(), 'saved');
  });

  it('coalesces debounced edits into one request, last write wins', async () => {
    const h = harness();
    h.queue.queue({ description: 'a' }, { debounceMs: 800 });
    h.queue.queue({ description: 'ab' }, { debounceMs: 800 });
    h.queue.queue({ name: 'N' }, { debounceMs: 800 });
    assert.equal(h.calls.length, 0);
    h.clock.advance(800);
    await settle();
    assert.deepEqual(h.calls, [{ description: 'ab', name: 'N' }]);
  });

  it('flush sends pending edits without waiting out the debounce', async () => {
    const h = harness();
    h.queue.queue({ description: 'typing' }, { debounceMs: 800 });
    h.queue.flush();
    await settle();
    assert.deepEqual(h.calls, [{ description: 'typing' }]);
  });

  it('holds edits made mid-flight and sends one follow-up request', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const h = harness(() => gate);
    h.queue.queue({ name: 'first' });
    await settle();
    h.queue.queue({ description: 'second' });
    h.queue.queue({ location: 'third' });
    assert.equal(h.calls.length, 1);
    release();
    await settle();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[1], { description: 'second', location: 'third' });
  });

  it('returns to idle after the saved display window', async () => {
    const h = harness();
    h.queue.queue({ name: 'A' });
    await settle();
    assert.equal(h.queue.getStatus(), 'saved');
    h.clock.advance(2000);
    assert.equal(h.queue.getStatus(), 'idle');
    assert.deepEqual(h.statuses, ['saving', 'saved', 'idle']);
  });

  it('keeps a failed patch and auto-retries once', async () => {
    const h = harness();
    h.setFail(true);
    h.queue.queue({ name: 'A' });
    await settle();
    assert.equal(h.queue.getStatus(), 'error');
    h.setFail(false);
    h.clock.advance(2000); // auto-retry
    await settle();
    assert.equal(h.calls.length, 2);
    assert.deepEqual(h.calls[1], { name: 'A' });
    assert.equal(h.queue.getStatus(), 'saved');
  });

  it('does not auto-retry a second time, but manual retry() works and merges new edits', async () => {
    const h = harness();
    h.setFail(true);
    h.queue.queue({ name: 'A' });
    await settle();
    h.clock.advance(2000); // auto-retry, still failing
    await settle();
    assert.equal(h.calls.length, 2);
    h.clock.advance(10000); // no further auto-retry
    await settle();
    assert.equal(h.calls.length, 2);
    assert.equal(h.queue.getStatus(), 'error');

    h.setFail(false);
    h.queue.queue({ description: 'new' }, { debounceMs: 800 });
    h.queue.retry();
    await settle();
    assert.equal(h.calls.length, 3);
    assert.deepEqual(h.calls[2], { name: 'A', description: 'new' });
    assert.equal(h.queue.getStatus(), 'saved');
  });

  it('dispose flushes pending edits and stops status callbacks', async () => {
    const h = harness();
    h.queue.queue({ description: 'unsaved' }, { debounceMs: 800 });
    h.queue.dispose();
    await settle();
    assert.deepEqual(h.calls, [{ description: 'unsaved' }]);
    assert.ok(!h.statuses.includes('saved')); // no callbacks after dispose
    h.queue.queue({ name: 'ignored' });
    await settle();
    assert.equal(h.calls.length, 1);
  });

  it('sends nothing when there is nothing to send', async () => {
    const h = harness();
    h.queue.flush();
    h.queue.retry();
    await settle();
    assert.equal(h.calls.length, 0);
    assert.equal(h.queue.getStatus(), 'idle');
  });
});
