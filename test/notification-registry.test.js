import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  captureNotificationInput,
  createNotificationRegistry,
  defaultDataDir,
} from '../lib/notification-registry.js';

const session = {
  id: 'session-a',
  header: { createdAt: 1_000, cwd: '/Users/example/project' },
};
const event = {
  type: 'turn/end',
  seq: 12,
  data: { turn: 3, reason: { kind: 'completed' } },
};
const state = { turn: 3, hasMessage: true, messageSeq: 11 };

async function withDataDir(body) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-turn-registry-'));
  try {
    return await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function idFactory() {
  let index = 0;
  return () => `id-${++index}`;
}

test('default data directories are profile-scoped', () => {
  assert.equal(
    defaultDataDir({ DSH_HOME: '/home/example', DSH_PROFILE: 'web' }),
    '/home/example/profiles/web/.turn-notifier',
  );
  assert.equal(
    defaultDataDir({ DSH_PROFILE_DIR: '/profiles/desktop' }),
    '/profiles/desktop/.turn-notifier',
  );
  assert.match(defaultDataDir({ DSH_HOME: '/home/example' }), /profiles[\\/]default[\\/]\.turn-notifier$/);
});

test('deployment identity survives reopen while instance identity changes', async () => {
  await withDataDir(async (dataDir) => {
    const newId = idFactory();
    const first = await createNotificationRegistry({ dataDir, newId });
    const deploymentId = first.deploymentId;
    const firstInstance = first.instanceId;
    await first.close();

    const second = await createNotificationRegistry({ dataDir, newId });
    assert.equal(second.deploymentId, deploymentId);
    assert.notEqual(second.instanceId, firstInstance);
    await second.close();
  });
});

test('a second live process cannot take the deployment lock', async () => {
  await withDataDir(async (dataDir) => {
    const first = await createNotificationRegistry({ dataDir });
    try {
      await assert.rejects(
        createNotificationRegistry({ dataDir }),
        { code: 'DEPLOYMENT_LOCKED' },
      );
    } finally {
      await first.close();
    }
  });
});

test('records capture the route, turn and reason', async () => {
  await withDataDir(async (dataDir) => {
    const registry = await createNotificationRegistry({ dataDir });
    try {
      const input = captureNotificationInput(session, event, state);
      const record = await registry.create(input);
      assert.equal(record.route.deploymentId, registry.deploymentId);
      assert.equal(record.route.sessionId, 'session-a');
      assert.equal(record.route.sessionCreatedAt, 1_000);
      assert.equal(record.turn, 3);
      assert.equal(record.eventSeq, 12);
      assert.equal(record.messageSeq, 11);
      assert.equal(record.reasonKind, 'completed');
      assert.equal(record.delivery, 'created');
      assert.deepEqual(registry.resolve(record.notificationId), { ok: true, record });
      assert.deepEqual(registry.resolve(record.notificationId, session), { ok: true, record });
    } finally {
      await registry.close();
    }
  });
});

test('identity mismatch, unknown ids and expiry are rejected without fallback', async () => {
  await withDataDir(async (dataDir) => {
    let now = 1_000;
    const registry = await createNotificationRegistry({
      dataDir,
      now: () => now,
      ttlMs: 100,
      newId: idFactory(),
    });
    try {
      const record = await registry.create(captureNotificationInput(session, event, state));
      assert.deepEqual(
        registry.resolve(record.notificationId, { id: 'session-a', header: { createdAt: 2_000 } }),
        { ok: false, code: 'notification/identity-mismatch' },
      );
      assert.deepEqual(registry.resolve('missing'), { ok: false, code: 'notification/not-found' });

      now = 1_101;
      assert.equal(registry.get(record.notificationId), undefined);
      assert.deepEqual(registry.resolve(record.notificationId), { ok: false, code: 'notification/not-found' });
    } finally {
      await registry.close();
    }
  });
});

test('delivery states are persisted', async () => {
  await withDataDir(async (dataDir) => {
    const registry = await createNotificationRegistry({ dataDir });
    try {
      const record = await registry.create(captureNotificationInput(session, event, state));
      await registry.markDelivery(record.notificationId, 'submitted');
      assert.equal(registry.get(record.notificationId).delivery, 'submitted');
    } finally {
      await registry.close();
    }
  });
});

test('record capacity keeps the newest records', async () => {
  await withDataDir(async (dataDir) => {
    let now = 1_000;
    const registry = await createNotificationRegistry({
      dataDir,
      maxRecords: 2,
      now: () => now,
    });
    try {
      const ids = [];
      for (let index = 0; index < 3; index += 1) {
        now += 1;
        ids.push((await registry.create(captureNotificationInput(session, event, state))).notificationId);
      }
      assert.equal(registry.list().length, 2);
      assert.equal(registry.get(ids[0]), undefined);
      assert.ok(registry.get(ids[1]));
      assert.ok(registry.get(ids[2]));
    } finally {
      await registry.close();
    }
  });
});

test('a corrupt records file is quarantined and does not abort startup', async () => {
  await withDataDir(async (dataDir) => {
    await writeFile(join(dataDir, 'records.json'), '{ not json');
    const registry = await createNotificationRegistry({ dataDir });
    try {
      assert.deepEqual(registry.list(), []);
      const entries = await import('node:fs/promises').then(({ readdir }) => readdir(dataDir));
      assert.ok(entries.some((entry) => entry.startsWith('records.json.corrupt-')));
      const deployment = JSON.parse(await readFile(join(dataDir, 'deployment.json'), 'utf8'));
      assert.equal(deployment.deploymentId, registry.deploymentId);
    } finally {
      await registry.close();
    }
  });
});
