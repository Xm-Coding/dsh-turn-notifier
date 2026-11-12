import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeError } from '../lib/diagnostics.js';
import {
  buildNotifierArguments,
  defaultNotifierPath,
  showMacOSNotification,
} from '../lib/macos-notifier.js';

test('applet receives message data only as positional argv', () => {
  const hostile = '"; display dialog "not code"; "';
  const args = buildNotifierArguments({
    title: hostile,
    subtitle: '本轮完成',
    body: hostile,
    soundName: 'Glass',
  });

  assert.deepEqual(args, [hostile, '本轮完成', hostile, 'Glass']);
  assert.ok(!defaultNotifierPath().endsWith('.js'));
  assert.ok(defaultNotifierPath().includes('AppleScriptNotifier.app/Contents/MacOS/applet'));
});

test('empty sound remains an empty fourth argument', () => {
  const args = buildNotifierArguments({
    title: 'Harness',
    subtitle: '完成',
    body: '回复',
    soundName: '',
  });
  assert.deepEqual(args, ['Harness', '完成', '回复', '']);
});

test('an optional notification id is passed after the display arguments', () => {
  const args = buildNotifierArguments({
    title: 'Harness',
    subtitle: '完成',
    body: '回复',
    soundName: '',
    notificationId: 'notification-1',
  });
  assert.deepEqual(args, ['Harness', '完成', '回复', '', 'notification-1']);
});

test('non-macOS platforms fail explicitly', async () => {
  await assert.rejects(
    showMacOSNotification({ title: 't', subtitle: 's', body: 'b' }, { platform: 'linux' }),
    { code: 'UNSUPPORTED_PLATFORM', message: /unsupported on linux/ },
  );
});

const SENTINEL = 'SENTINEL-正文-9c1d';
const notification = { title: 't', subtitle: 's', body: `"; ${SENTINEL} $(whoami)`, soundName: '' };

/** Run `body` against a throwaway helper executable standing in for the applet. */
async function withHelper(script, mode, body) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-turn-notifier-'));
  try {
    const helper = join(dir, 'applet');
    await writeFile(helper, script, { mode });
    return await body(helper);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected the notification to fail');
}

test('a failing helper is summarized without argv or stderr', async () => {
  await withHelper('#!/bin/sh\nprintf "%s" "$3" >&2\nexit 3\n', 0o755, async (helper) => {
    const error = await failureOf(showMacOSNotification(notification, { platform: 'darwin', notifierPath: helper }));
    // The raw error does carry the body, which is why it must not be logged.
    assert.ok(String(error).includes(SENTINEL));
    assert.ok(error.stderr.includes(SENTINEL));
    assert.equal(describeError(error), 'exit-code=3');
  });
});

test('a helper timeout is summarized as a timeout', async () => {
  await withHelper('#!/bin/sh\nexec sleep 5\n', 0o755, async (helper) => {
    const error = await failureOf(
      showMacOSNotification(notification, { platform: 'darwin', notifierPath: helper, timeout: 100 }),
    );
    assert.equal(describeError(error), 'timeout signal=SIGTERM');
  });
});

test('a helper that cannot be spawned is summarized by its error code', async () => {
  await withHelper('#!/bin/sh\nexit 0\n', 0o644, async (helper) => {
    const error = await failureOf(showMacOSNotification(notification, { platform: 'darwin', notifierPath: helper }));
    assert.ok(JSON.stringify(error.spawnargs).includes(SENTINEL));
    assert.equal(describeError(error), 'code=EACCES');
  });
});

test('a missing helper has a stable code', async () => {
  const error = await failureOf(
    showMacOSNotification(notification, { platform: 'darwin', notifierPath: join(tmpdir(), 'no-such-dsh-applet') }),
  );
  assert.equal(describeError(error), 'code=HELPER_MISSING');
});
