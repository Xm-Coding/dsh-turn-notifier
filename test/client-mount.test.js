import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

test('built client bundle mounts the generated Remote contribution', async () => {
  const previousWindow = globalThis.window;
  let factory;
  globalThis.window = {
    __ModuleLoader__: {
      load(entry) {
        factory = entry.factory;
      },
    },
  };
  try {
    new Function(await readFile(join(process.cwd(), 'client', 'client.js'), 'utf8'))();
  } finally {
    globalThis.window = previousWindow;
  }

  assert.equal(typeof factory, 'function');
  const plugin = factory((id) => {
    throw new Error(`unexpected module request: ${id}`);
  });
  assert.deepEqual(plugin.inject, ['remote', 'uiWorkspace', 'uiSession']);

  let setup;
  let mounted;
  let disposed = false;
  let registration;
  plugin.apply({
    effect(callback) {
      setup = callback;
    },
    uiWorkspace: { openSession(sessionId) { this.opened = sessionId; } },
    uiSession: { adapter: { current: { value: { props: { sessionId: 'session-ui' } } } } },
    remote: {
      async $mount(contribution) {
        mounted = contribution;
        return () => {
          disposed = true;
        };
      },
      turnNotifier: {
        async registerClient(request) {
          registration = request;
          return { ok: true, value: { deploymentId: 'deployment-a' } };
        },
        async claimAction() {
          return { ok: true, value: null };
        },
        async completeAction() {
          return { ok: true, value: { accepted: true } };
        },
      },
    },
  });

  const cleanup = await setup();
  assert.equal(mounted.package, 'dsh-turn-notifier');
  assert.ok(mounted.methods['turnNotifier/ping']);
  assert.ok(mounted.methods['turnNotifier/registerClient']);
  assert.equal(registration.sessionId, 'session-ui');
  assert.equal(registration.generation, 1);
  cleanup();
  assert.equal(disposed, true);
});

test('a claimed open action opens its session and reports opened', async () => {
  const previousWindow = globalThis.window;
  let factory;
  globalThis.window = { __ModuleLoader__: { load(entry) { factory = entry.factory; } } };
  try {
    new Function(await readFile(join(process.cwd(), 'client', 'client.js'), 'utf8'))();
  } finally {
    globalThis.window = previousWindow;
  }
  const plugin = factory(() => { throw new Error('unexpected require'); });
  let setup;
  let attempts = 0;
  let opened;
  let completion;
  plugin.apply({
    effect(callback) { setup = callback; },
    uiWorkspace: { openSession(sessionId) { opened = sessionId; } },
    remote: {
      async $mount() { return () => {}; },
      turnNotifier: {
        async registerClient() { return { ok: true, value: {} }; },
        async claimAction() {
          attempts += 1;
          return {
            ok: true,
            value: attempts === 1 ? {
              actionId: 'action-1',
              kind: 'open',
              sessionId: 'session-a',
              leaseExpiresAt: Date.now() + 30_000,
            } : null,
          };
        },
        async completeAction(request) { completion = request; return { ok: true, value: {} }; },
      },
    },
  });
  const cleanup = await setup();
  await new Promise((resolve) => setTimeout(resolve, 1_200));
  cleanup();
  assert.equal(opened, 'session-a');
  assert.equal(completion.actionId, 'action-1');
  assert.equal(completion.status, 'opened');
});
