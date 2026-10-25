import test from 'node:test';
import assert from 'node:assert/strict';
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

test('non-macOS platforms fail explicitly', async () => {
  await assert.rejects(
    showMacOSNotification({ title: 't', subtitle: 's', body: 'b' }, { platform: 'linux' }),
    /unsupported on linux/,
  );
});
