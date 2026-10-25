import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTurnNotification,
  normalizeSettings,
  normalizeText,
  truncateText,
} from '../lib/notification.js';

const session = {
  id: 'session-1',
  header: { cwd: '/Users/example/demo-project' },
};

function turnEnd(kind = 'completed', extra = {}) {
  return {
    type: 'turn/end',
    seq: 30,
    data: { turn: 2, reason: { kind, ...extra } },
  };
}

const finalState = {
  turn: 2,
  hasMessage: true,
  lastText: '  已完成安装。\n\n\n通知正文来自最终回复。  ',
  messageSeq: 29,
};

test('completed turn notifies with final assistant text and project name', () => {
  const notification = buildTurnNotification(session, turnEnd(), finalState);
  assert.deepEqual(notification, {
    title: 'DeepSeek Harness',
    subtitle: '本轮已完成 · demo-project',
    body: '已完成安装。\n\n通知正文来自最终回复。',
    soundName: 'Glass',
  });
});

test('only the matching turn supplies message text', () => {
  const notification = buildTurnNotification(session, turnEnd(), {
    ...finalState,
    turn: 1,
  });
  assert.equal(notification.body, '本轮已完成。');
});

test('a final tool-only message has an explicit fallback', () => {
  const notification = buildTurnNotification(session, turnEnd(), {
    ...finalState,
    lastText: '',
  });
  assert.equal(notification.body, '本轮已完成，最终消息没有文本内容。');
});

test('error and cancellation notifications are opt-in', () => {
  assert.equal(buildTurnNotification(session, turnEnd('error'), finalState), null);
  assert.equal(buildTurnNotification(session, turnEnd('aborted'), finalState), null);

  const error = buildTurnNotification(
    session,
    turnEnd('error', { error: { message: '网络连接失败' } }),
    { ...finalState, lastText: '' },
    { notifyOnError: true },
  );
  assert.equal(error.subtitle, '本轮出错 · demo-project');
  assert.equal(error.body, '网络连接失败');

  const cancelled = buildTurnNotification(session, turnEnd('aborted'), finalState, {
    notifyOnCancel: true,
  });
  assert.equal(cancelled.subtitle, '本轮已停止 · demo-project');
});

test('max-tokens has a distinct status', () => {
  const notification = buildTurnNotification(session, turnEnd('max-tokens'), finalState);
  assert.equal(notification.subtitle, '本轮已达输出上限 · demo-project');
  assert.match(notification.body, /最终回复/);
});

test('message content can be hidden', () => {
  const notification = buildTurnNotification(session, turnEnd(), finalState, {
    includeMessage: false,
  });
  assert.equal(notification.body, '本轮已完成。');
});

test('text normalization and truncation preserve Unicode code points', () => {
  assert.equal(normalizeText(' a\t b\r\n\r\n\r\n c '), 'a b\n\nc');
  const settings = normalizeSettings({ maxCharacters: 40 });
  assert.equal(settings.maxCharacters, 40);
  const truncated = truncateText('😀'.repeat(50), 40);
  assert.equal(Array.from(truncated).length, 40);
  assert.ok(truncated.endsWith('…'));
  assert.ok(!truncated.includes('\uFFFD'));
});

test('configuration bounds are applied', () => {
  const settings = normalizeSettings({ maxCharacters: 999999, soundName: '', title: '  通知  ' });
  assert.equal(settings.maxCharacters, 2000);
  assert.equal(settings.soundName, '');
  assert.equal(settings.title, '通知');
});
