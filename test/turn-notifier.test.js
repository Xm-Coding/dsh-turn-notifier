import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings } from '../lib/notification.js';
import { PROJECTION_KEY } from '../lib/projection.js';
import { startTurnNotifier } from '../lib/turn-notifier.js';

const SENTINEL = 'SENTINEL-回复-2d6e';
const rootSession = { id: 'root', header: { cwd: '/Users/example/demo-project' } };
const childSession = { id: 'child', header: { cwd: '/Users/example/demo-project', origin: 'subagent' } };

function turnEnd(turn, seq, kind = 'completed') {
  return { type: 'turn/end', seq, data: { turn, reason: { kind } } };
}

function assistantMessage(turn, seq, text) {
  return {
    type: 'assistant/message',
    seq,
    data: { turn, message: { role: 'assistant', content: [{ type: 'text', text }] } },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Harness's register() result: callable (deprecated disposer) and awaitable. */
function callableThenable(settled) {
  const registration = () => {};
  registration.then = (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected);
  return registration;
}

/**
 * Minimal stand-in for the Host context: a `session/event` emitter, the agents
 * registry (`root` is top-level, `child` is owned), a projection registry whose
 * handle reads `states`, and optional services reading `log`, `titles`, and
 * `directories`.
 */
function createHost({ registration, legacyStateOf, services = {}, agentRoots = true } = {}) {
  const listeners = [];
  const warnings = [];
  const states = new Map();
  const log = new Map();
  const titles = new Map();
  const directories = new Map();
  const queryReads = [];
  const effectCleanups = [];
  const handle = { stateOf: (session) => states.get(session.id) };
  const root = { id: 'root' };
  const agents = new Map([['root', root], ['child', { id: 'child' }]]);
  const defaultServices = {
    sessionQuery: {
      async readEvent({ sessionId, seq }) {
        queryReads.push(`${sessionId}:${seq}`);
        return { target: log.get(`${sessionId}:${seq}`) };
      },
    },
    sessionTitle: { get: (session) => titles.get(session.id) },
    workingDirectory: { get: (session) => directories.get(session.id) },
  };
  const ctx = {
    on(name, listener) {
      assert.equal(name, 'session/event');
      listeners.push(listener);
      return () => {};
    },
    effect(callback) {
      const cleanup = callback();
      effectCleanups.push(cleanup);
      return () => cleanup();
    },
    get: (name) => ({ ...defaultServices, ...services })[name],
    logger: { warn: (message) => warnings.push(message) },
    agents: { get: (id) => agents.get(id), ...(agentRoots ? { roots: () => [root] } : {}) },
    sessionProjections: {
      register(definition) {
        assert.equal(definition.key, PROJECTION_KEY);
        return registration ?? callableThenable(Promise.resolve(handle));
      },
      stateOf: legacyStateOf ?? (() => {
        throw new Error('deprecated registry-level read was used');
      }),
    },
  };
  const emit = (session, event) => {
    for (const listener of listeners) listener(session, event);
  };
  /** Record a final assistant message the way the log and projection would. */
  const finishTurn = (session, turn, seq, text) => {
    log.set(`${session.id}:${seq}`, assistantMessage(turn, seq, text));
    states.set(session.id, { turn, hasMessage: true, messageSeq: seq });
  };
  return {
    ctx,
    emit,
    finishTurn,
    states,
    log,
    titles,
    directories,
    warnings,
    queryReads,
    handle,
    effectCleanups,
    dispose() {
      for (const cleanup of effectCleanups.splice(0)) cleanup();
    },
  };
}

function recorder() {
  const sent = [];
  return { sent, notify: async (notification) => { sent.push(notification); } };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('reads the final reply by its recorded seq and labels the session', async () => {
  const host = createHost();
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 1, 4, '已完成。');
  host.titles.set('root', { title: '整理通知插件' });
  host.emit(rootSession, assistantMessage(1, 4, '已完成。'));
  host.emit(rootSession, turnEnd(1, 5));
  await settle();

  assert.deepEqual(host.queryReads, ['root:4']);
  assert.deepEqual(sent, [{
    title: 'DeepSeek Harness',
    subtitle: '本轮已完成 · 整理通知插件',
    body: '已完成。',
    soundName: 'Glass',
  }]);
});

test('a turn that starts before delivery cannot change the notification', async () => {
  const host = createHost();
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 1, 4, '第一轮的回复');
  host.directories.set('root', '/Users/example/first');
  host.emit(rootSession, turnEnd(1, 5));
  // Synchronously after turn/end: the next turn begins and moves directory.
  host.finishTurn(rootSession, 2, 9, '第二轮的回复');
  host.directories.set('root', '/Users/example/second');
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, '第一轮的回复');
  assert.equal(sent[0].subtitle, '本轮已完成 · first');
});

test('the reply text is not read when it will not be shown', async () => {
  const host = createHost();
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings({ includeMessage: false, notifyOnError: true }), { notify });

  host.finishTurn(rootSession, 1, 4, SENTINEL);
  host.emit(rootSession, turnEnd(1, 5));
  host.emit(rootSession, turnEnd(1, 6, 'error'));
  await settle();

  assert.deepEqual(host.queryReads, []);
  assert.deepEqual(sent.map((notification) => notification.body), ['本轮已完成。', '本轮出错，请回到 Harness 查看详情。']);
});

test('a failed reply read falls back to status text and logs only its category', async () => {
  const host = createHost({ services: { sessionQuery: undefined } });
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 1, 4, SENTINEL);
  host.emit(rootSession, turnEnd(1, 5));
  await settle();

  assert.deepEqual(sent.map((notification) => notification.body), ['本轮已完成。']);
  assert.deepEqual(host.warnings, [
    '[dsh-turn-notifier] reply preview unavailable for session root, turn 1: code=SESSION_QUERY_UNAVAILABLE',
  ]);
});

test('a turn ending while registration is pending is delivered afterwards', async () => {
  const gate = deferred();
  const host = createHost({ registration: callableThenable(gate.promise) });
  const { sent, notify } = recorder();
  const started = startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 2, 8, '插件加载期间结束的一轮');
  host.emit(rootSession, turnEnd(2, 9));
  await settle();
  assert.equal(sent.length, 0);

  gate.resolve(host.handle);
  await started;
  await settle();
  assert.deepEqual(sent.map((notification) => notification.body), ['插件加载期间结束的一轮']);
});

test('a failed registration rejects and drops held turn endings', async () => {
  const gate = deferred();
  const host = createHost({ registration: callableThenable(gate.promise) });
  const { sent, notify } = recorder();
  const started = startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 3, 10, '不会发送');
  host.emit(rootSession, turnEnd(3, 11));
  gate.reject(new Error('key conflict'));

  await assert.rejects(started, /key conflict/);
  host.emit(rootSession, turnEnd(3, 12));
  await settle();
  assert.equal(sent.length, 0);
});

test('older registries are read through the legacy registry call', async () => {
  const keys = [];
  const host = createHost({
    registration: () => {},
    legacyStateOf(session, key) {
      keys.push(key);
      return { turn: 1, hasMessage: true, messageSeq: 2 };
    },
  });
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.log.set('root:2', assistantMessage(1, 2, '旧版读取'));
  host.emit(rootSession, turnEnd(1, 3));
  await settle();
  assert.deepEqual(sent.map((notification) => notification.body), ['旧版读取']);
  assert.deepEqual(keys, [PROJECTION_KEY]);
});

test('delivery failures are logged without notification text after retries', async () => {
  const host = createHost();
  const notify = async () => {
    throw Object.assign(new Error(`Command failed: applet t s ${SENTINEL}`), {
      code: 1,
      cmd: `applet t s ${SENTINEL}`,
      stderr: SENTINEL,
    });
  };
  await startTurnNotifier(host.ctx, normalizeSettings(), {
    notify,
    deliveryOptions: { sleep: async () => {} },
  });

  host.finishTurn(rootSession, 1, 4, SENTINEL);
  host.emit(rootSession, turnEnd(1, 5));
  await settle();

  assert.deepEqual(host.warnings, [
    '[dsh-turn-notifier] notification failed for session root, turn 1 after 4 attempts: exit-code=1',
  ]);
});

test('listener failures are logged without their message', async () => {
  const host = createHost();
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });
  host.handle.stateOf = () => {
    throw new TypeError(SENTINEL);
  };

  host.emit(rootSession, turnEnd(1, 5));
  await settle();
  assert.equal(sent.length, 0);
  assert.deepEqual(host.warnings, ['[dsh-turn-notifier] turn listener failed: error=TypeError']);
});

test('root filtering falls back to session origin when agents.roots is absent', async () => {
  const host = createHost({ agentRoots: false });
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 1, 4, '根会话完成');
  host.emit(rootSession, turnEnd(1, 5));
  host.finishTurn(childSession, 1, 4, '子代理完成');
  host.emit(childSession, turnEnd(1, 5));
  await settle();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].title, 'DeepSeek Harness');
});

test('subagent sessions notify only when enabled', async () => {
  for (const includeSubagents of [false, true]) {
    const host = createHost();
    const { sent, notify } = recorder();
    await startTurnNotifier(host.ctx, normalizeSettings({ includeSubagents }), { notify });
    host.finishTurn(childSession, 1, 4, '子代理完成');
    host.emit(childSession, turnEnd(1, 5));
    await settle();
    assert.equal(sent.length, includeSubagents ? 1 : 0, `includeSubagents=${includeSubagents}`);
  }
});

test('a repeated turn end notifies once', async () => {
  const host = createHost();
  const { sent, notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  host.finishTurn(rootSession, 1, 4, '只提醒一次');
  host.emit(rootSession, turnEnd(1, 5));
  host.emit(rootSession, turnEnd(1, 5));
  await settle();
  assert.equal(sent.length, 1);
});

test('delivery cleanup is registered on the plugin fiber', async () => {
  const host = createHost();
  const { notify } = recorder();
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify });

  assert.equal(host.effectCleanups.length, 1);
  assert.equal(typeof host.effectCleanups[0], 'function');
  host.dispose();
  assert.equal(host.effectCleanups.length, 0);
});


test('persists the route before delivery and records the submitted state', async () => {
  const host = createHost();
  const calls = [];
  const registry = {
    async create(input) {
      calls.push(['create', input.route.sessionId, input.turn]);
      return { notificationId: 'notification-1' };
    },
    async markDelivery(id, state) {
      calls.push(['delivery', id, state]);
    },
  };
  const notify = async (notification) => {
    calls.push(['notify', notification.notificationId]);
  };
  const routeSession = { id: 'root', header: { cwd: '/Users/example/demo-project', createdAt: 100 } };
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify, registry });

  host.finishTurn(routeSession, 1, 4, '已完成。');
  host.emit(routeSession, turnEnd(1, 5));
  await settle();

  assert.deepEqual(calls, [
    ['create', 'root', 1],
    ['notify', 'notification-1'],
    ['delivery', 'notification-1', 'submitted'],
  ]);
});

test('a registry failure still sends the basic notification', async () => {
  const host = createHost();
  const { sent, notify } = recorder();
  const registry = {
    async create() {
      throw new Error('registry unavailable');
    },
    async markDelivery() {
      assert.fail('markDelivery should not run when creation failed');
    },
  };
  const routeSession = { id: 'root', header: { cwd: '/Users/example/demo-project', createdAt: 100 } };
  await startTurnNotifier(host.ctx, normalizeSettings(), { notify, registry });

  host.finishTurn(routeSession, 1, 4, '基本通知仍然可用。');
  host.emit(routeSession, turnEnd(1, 5));
  await settle();

  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, '基本通知仍然可用。');
  assert.match(host.warnings[0], /notification record failed/);
});

test('retries reuse one notification record', async () => {
  const host = createHost();
  let creates = 0;
  let attempts = 0;
  const deliveries = [];
  const registry = {
    async create() {
      creates += 1;
      return { notificationId: 'notification-retry' };
    },
    async markDelivery(id, state) {
      deliveries.push([id, state]);
    },
  };
  const notify = async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error('transient'), { code: 1 });
  };
  const routeSession = { id: 'root', header: { cwd: '/Users/example/demo-project', createdAt: 100 } };
  await startTurnNotifier(host.ctx, normalizeSettings(), {
    notify,
    registry,
    deliveryOptions: { sleep: async () => {} },
  });

  host.finishTurn(routeSession, 1, 4, '重试回复');
  host.emit(routeSession, turnEnd(1, 5));
  await settle();
  await settle();

  assert.equal(creates, 1);
  assert.deepEqual(deliveries, [
    ['notification-retry', 'failed'],
    ['notification-retry', 'submitted'],
  ]);
});
