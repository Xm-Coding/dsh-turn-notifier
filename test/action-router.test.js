import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionRouter } from '../lib/action-router.js';

const record = {
  notificationId: 'notification-1',
  route: { sessionId: 'session-a' },
  expiresAt: 10_000,
};

function fixture(options = {}) {
  let now = options.now ?? 1_000;
  let id = 0;
  const registry = {
    deploymentId: 'deployment-a',
    instanceId: 'instance-a',
    resolve(notificationId) {
      return notificationId === record.notificationId
        ? { ok: true, record }
        : { ok: false, code: 'notification/not-found' };
    },
  };
  const router = new ActionRouter({
    registry,
    now: () => now,
    newId: () => `action-${++id}`,
    ...options.router,
  });
  return { router, registry, setNow: (value) => { now = value; } };
}

function client(clientId = 'client-a', generation = 1, sessionId = 'session-a') {
  return { clientId, generation, sessionId, focused: true, capabilities: ['open'] };
}

test('registration returns the Host deployment and client generation', () => {
  const { router } = fixture();
  assert.deepEqual(router.registerClient(client()), {
    deploymentId: 'deployment-a',
    instanceId: 'instance-a',
    leaseMs: 30_000,
    stale: false,
  });
  assert.deepEqual(router.listClients(), [{
    clientId: 'client-a',
    generation: 1,
    sessionId: 'session-a',
    focused: true,
    capabilities: ['open'],
    lastSeen: 1_000,
  }]);
});

test('an older client generation cannot claim actions', () => {
  const { router } = fixture();
  router.registerClient(client('client-a', 2));
  assert.throws(
    () => router.claimAction({ clientId: 'client-a', generation: 1, sessionId: 'session-a', focused: true }),
    { code: 'client/stale-generation' },
  );
});

test('an action is queued once and completed idempotently', () => {
  const { router } = fixture();
  router.registerClient(client());
  const queued = router.enqueue({ notificationId: 'notification-1', kind: 'open' });
  assert.equal(queued.ok, true);
  assert.equal(queued.action.sessionId, 'session-a');
  const again = router.enqueue({ notificationId: 'notification-1', kind: 'open' });
  assert.equal(again.action.actionId, queued.action.actionId);

  const claimed = router.claimAction({
    clientId: 'client-a', generation: 1, sessionId: 'session-a', focused: true,
  });
  assert.equal(claimed.actionId, queued.action.actionId);
  assert.equal(claimed.kind, 'open');

  const request = {
    clientId: 'client-a',
    generation: 1,
    actionId: claimed.actionId,
    status: 'opened',
    errorCode: '',
  };
  assert.deepEqual(router.completeAction(request), { accepted: true, duplicate: false });
  assert.deepEqual(router.completeAction(request), { accepted: true, duplicate: true });
});

test('a different client cannot complete a claimed action', () => {
  const { router } = fixture();
  router.registerClient(client('client-a'));
  router.registerClient(client('client-b'));
  const queued = router.enqueue({ notificationId: 'notification-1', kind: 'open' });
  router.claimAction({ clientId: 'client-a', generation: 1, sessionId: 'session-a', focused: true });
  assert.deepEqual(router.completeAction({
    clientId: 'client-b',
    generation: 1,
    actionId: queued.action.actionId,
    status: 'opened',
    errorCode: '',
  }), { accepted: false, duplicate: false });
});

test('an expired lease can be reclaimed by another Client', () => {
  const { router, setNow, registry } = fixture();
  registry.resolve = () => ({ ok: true, record: { ...record, expiresAt: 100_000 } });
  router.registerClient(client('client-a'));
  router.registerClient(client('client-b'));
  const queued = router.enqueue({ notificationId: 'notification-1', kind: 'open' });
  const first = router.claimAction({ clientId: 'client-a', generation: 1, sessionId: 'session-a', focused: true });
  assert.equal(first.actionId, queued.action.actionId);
  setNow(31_001);
  const second = router.claimAction({ clientId: 'client-b', generation: 1, sessionId: 'session-a', focused: true });
  assert.equal(second.actionId, queued.action.actionId);
  assert.equal(second.leaseExpiresAt, 61_001);
});

test('actions prefer the Client currently viewing the target session', () => {
  const { router, registry } = fixture();
  const records = {
    'notification-1': { ok: true, record: { ...record, route: { sessionId: 'session-a' } } },
    'notification-2': { ok: true, record: { ...record, notificationId: 'notification-2', route: { sessionId: 'session-b' } } },
  };
  registry.resolve = (id) => records[id] ?? { ok: false, code: 'notification/not-found' };
  router.registerClient(client('client-a', 1, 'session-a'));
  router.registerClient(client('client-b', 1, 'session-b'));
  router.enqueue({ notificationId: 'notification-1', kind: 'open' });
  const forB = router.enqueue({ notificationId: 'notification-2', kind: 'open' });
  const claimed = router.claimAction({ clientId: 'client-b', generation: 1, sessionId: 'session-b', focused: true });
  assert.equal(claimed.actionId, forB.action.actionId);
});

test('unknown notifications and invalid actions have explicit failures', () => {
  const { router } = fixture();
  assert.deepEqual(router.enqueue({ notificationId: 'missing', kind: 'open' }), {
    ok: false,
    code: 'notification/not-found',
  });
  assert.throws(() => router.enqueue({ notificationId: 'notification-1', kind: 'run-shell' }), {
    code: 'action/invalid-kind',
  });
  assert.throws(() => router.enqueue({ notificationId: 'notification-1', kind: 'reply' }), {
    code: 'action/invalid-kind',
  });
});
