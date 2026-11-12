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

const SENTINEL = 'SENTINEL-私密-7f3a';
const allNotifications = { notifyOnError: true, notifyOnCancel: true };

test('hidden previews show only status text for every notifying reason', () => {
  const cases = [
    [turnEnd('completed'), '本轮已完成。'],
    [turnEnd('max-tokens'), '模型已达到本轮输出上限。'],
    [turnEnd('error', { error: { message: SENTINEL, code: 'UNKNOWN' } }), '本轮出错，请回到 Harness 查看详情。'],
    [turnEnd('aborted', { reason: { kind: 'user' } }), '本轮已被手动停止。'],
  ];
  for (const [event, expectedBody] of cases) {
    const notification = buildTurnNotification(session, event, { ...finalState, lastText: SENTINEL }, {
      ...allNotifications,
      includeMessage: false,
    });
    assert.equal(notification.body, expectedBody, event.data.reason.kind);
    assert.ok(!JSON.stringify(notification).includes(SENTINEL), event.data.reason.kind);
  }
});

test('an errored turn shows the error instead of earlier assistant text', () => {
  const notification = buildTurnNotification(
    session,
    turnEnd('error', { error: { message: '模型服务返回 500', code: 'SERVER_ERROR' } }),
    { ...finalState, lastText: '我先看一下配置文件……' },
    { notifyOnError: true },
  );
  assert.equal(notification.body, '模型服务返回 500');
});

test('an errored turn without an error message falls back to status text', () => {
  const notification = buildTurnNotification(
    session,
    turnEnd('error', { error: { code: 'UNKNOWN' } }),
    { ...finalState, lastText: '我先看一下配置文件……' },
    { notifyOnError: true },
  );
  assert.equal(notification.body, '本轮出错，请回到 Harness 查看详情。');
});

test('a stopped turn does not present earlier assistant text as its result', () => {
  const notification = buildTurnNotification(
    session,
    turnEnd('aborted', { reason: { kind: 'user' } }),
    { ...finalState, lastText: '我先看一下配置文件……' },
    { notifyOnCancel: true },
  );
  assert.equal(notification.body, '本轮已被手动停止。');
});

test('each abort cause has its own status', () => {
  const cases = [
    [{ kind: 'user' }, '本轮已手动停止'],
    [{ kind: 'parent' }, '本轮已被上级任务停止'],
    [{ kind: 'hook', reason: 'policy' }, '本轮已被钩子停止'],
    [{ kind: 'legacy' }, '本轮已停止'],
    [{ kind: 'some-future-cause' }, '本轮已停止'],
    [undefined, '本轮已停止'],
  ];
  for (const [cause, label] of cases) {
    const extra = cause === undefined ? {} : { reason: cause };
    const notification = buildTurnNotification(session, turnEnd('aborted', extra), finalState, {
      notifyOnCancel: true,
    });
    assert.equal(notification.subtitle, `${label} · demo-project`, String(cause?.kind));
  }
});

test('agent disposal never notifies, even with notifyOnCancel', () => {
  const event = turnEnd('aborted', { reason: { kind: 'disposed' } });
  assert.equal(buildTurnNotification(session, event, finalState, allNotifications), null);
});

test('blocked, interrupted and forked endings never notify', () => {
  for (const kind of ['blocked', 'interrupted', 'forked']) {
    assert.equal(buildTurnNotification(session, turnEnd(kind), finalState, allNotifications), null, kind);
  }
});

test('the subtitle names the session title when one exists', () => {
  const notification = buildTurnNotification(session, turnEnd(), finalState, {}, {
    title: '修复\n通知  插件',
    directory: '/Users/example/other-project',
  });
  assert.equal(notification.subtitle, '本轮已完成 · 修复 通知 插件');
});

test('long session titles are shortened in the subtitle', () => {
  const notification = buildTurnNotification(session, turnEnd(), finalState, {}, { title: '标'.repeat(100) });
  const context = notification.subtitle.split(' · ')[1];
  assert.equal(Array.from(context).length, 60);
  assert.ok(context.endsWith('…'));
});

test('without a title, or with titles hidden, the subtitle names the current directory', () => {
  const presentation = { title: '会话标题', directory: '/Users/example/moved-project' };
  assert.equal(
    buildTurnNotification(session, turnEnd(), finalState, { showSessionTitle: false }, presentation).subtitle,
    '本轮已完成 · moved-project',
  );
  assert.equal(
    buildTurnNotification(session, turnEnd(), finalState, {}, { directory: '/Users/example/moved-project' }).subtitle,
    '本轮已完成 · moved-project',
  );
  assert.equal(
    buildTurnNotification({ id: 'bare', header: {} }, turnEnd(), finalState, {}, {}).subtitle,
    '本轮已完成',
  );
});

test('showSessionTitle defaults to on', () => {
  assert.equal(normalizeSettings({}).showSessionTitle, true);
  assert.equal(normalizeSettings({ showSessionTitle: false }).showSessionTitle, false);
});
