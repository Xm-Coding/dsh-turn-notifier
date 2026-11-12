import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeHelper } from '../lib/native-helper.js';

async function fixture(body) {
  const dataDir = await mkdtemp(join(tmpdir(), 'dsh-native-helper-'));
  try {
    const helper = createNativeHelper({
      dataDir,
      appPath: '/fake/DSHNativeNotifier.app',
      deploymentId: 'deployment-a',
      pollMs: 10,
      launch: async () => {
        await writeFile(join(dataDir, 'helper.pid'), JSON.stringify({
          pid: process.pid,
          deploymentId: 'deployment-a',
        }));
      },
    });
    return await body(helper, dataDir);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
}

test('starts from a pid handshake, writes notifications and consumes actions', async () => {
  await fixture(async (helper, dataDir) => {
    assert.equal(await helper.start(), true);
    await helper.show({
      notificationId: 'notification-a',
      title: 'Harness',
      subtitle: '完成',
      body: '正文',
      soundName: 'Glass',
    });
    const requestFiles = await readdir(join(dataDir, 'helper-requests'));
    assert.equal(requestFiles.length, 1);
    const request = JSON.parse(await readFile(join(dataDir, 'helper-requests', requestFiles[0]), 'utf8'));
    assert.equal(request.notificationId, 'notification-a');

    await writeFile(join(dataDir, 'helper-actions.ndjson'), `${JSON.stringify({
      protocolVersion: 1,
      deploymentId: 'deployment-a',
      notificationId: 'notification-a',
      kind: 'open',
    })}\n`);
    let received;
    helper.setActionHandler((action) => { received = action; });
    await helper.poll();
    assert.deepEqual(received, {
      notificationId: 'notification-a',
      kind: 'open',
    });

    await helper.close();
    const after = await readdir(join(dataDir, 'helper-requests'));
    assert.ok(after.includes('stop.json'));
  });
});

test('ignores malformed and foreign-deployment actions', async () => {
  await fixture(async (helper, dataDir) => {
    await helper.start();
    await writeFile(join(dataDir, 'helper-actions.ndjson'), [
      '{bad json',
      JSON.stringify({ protocolVersion: 1, deploymentId: 'other', notificationId: 'n', kind: 'open' }),
      JSON.stringify({ protocolVersion: 1, deploymentId: 'deployment-a', notificationId: 'n', kind: 'run' }),
      JSON.stringify({ protocolVersion: 1, deploymentId: 'deployment-a', notificationId: 'n', kind: 'reply' }),
      JSON.stringify({ protocolVersion: 1, deploymentId: 'deployment-a', notificationId: 'n', kind: 'open' }),
    ].join('\n') + '\n');
    const received = [];
    helper.setActionHandler((action) => received.push(action));
    await helper.poll();
    assert.deepEqual(received, [{ notificationId: 'n', kind: 'open' }]);
  });
});

test('does not reuse a pid from another deployment', async () => {
  let launches = 0;
  await fixture(async (helper, dataDir) => {
    helper.launch = async () => {
      launches += 1;
      await writeFile(join(dataDir, 'helper.pid'), JSON.stringify({ pid: process.pid, deploymentId: 'deployment-a' }));
    };
    await writeFile(join(dataDir, 'helper.pid'), JSON.stringify({ pid: process.pid, deploymentId: 'other' }));
    assert.equal(await helper.start(), true);
    assert.equal(launches, 1);
  });
});
