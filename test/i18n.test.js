import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSettings, buildTurnNotification } from '../lib/notification.js';
import { copyFor, normalizeLocale, resolveLocale } from '../lib/i18n.js';

const session = { id: 'session-1', header: { cwd: '/Users/example/demo-project' } };
const state = { turn: 2, hasMessage: true, lastText: '回复正文', messageSeq: 29 };

function turnEnd(kind = 'completed', extra = {}) {
  return { type: 'turn/end', seq: 30, data: { turn: 2, reason: { kind, ...extra } } };
}

test('auto is the default and resolves to the documented Chinese fallback', () => {
  assert.equal(normalizeSettings({}).locale, 'auto');
  assert.equal(resolveLocale('auto'), 'zh');
  assert.equal(normalizeLocale('en-US'), 'en');
  assert.equal(normalizeLocale('zh-CN'), 'zh');
  assert.equal(normalizeLocale('fr-FR'), 'auto');
  assert.equal(copyFor('auto').status.completed.label, '本轮已完成');
});

test('English notifications use the English locale resource', () => {
  const notification = buildTurnNotification(
    session,
    turnEnd(),
    state,
    { locale: 'en' },
  );
  assert.deepEqual(notification, {
    title: 'DeepSeek Harness',
    subtitle: 'Turn completed · demo-project',
    body: '回复正文',
    soundName: 'Glass',
  });
});

test('English status copy covers max tokens, errors and aborts', () => {
  const maxTokens = buildTurnNotification(session, turnEnd('max-tokens'), state, { locale: 'en' });
  assert.equal(maxTokens.subtitle, 'Output limit reached · demo-project');

  const error = buildTurnNotification(
    session,
    turnEnd('error', { error: { message: 'network unavailable' } }),
    { ...state, lastText: '' },
    { locale: 'en', notifyOnError: true },
  );
  assert.equal(error.subtitle, 'Turn failed · demo-project');
  assert.equal(error.body, 'network unavailable');

  const stopped = buildTurnNotification(
    session,
    turnEnd('aborted', { reason: { kind: 'user' } }),
    state,
    { locale: 'en', notifyOnCancel: true },
  );
  assert.equal(stopped.subtitle, 'Turn stopped manually · demo-project');
  assert.equal(stopped.body, 'The turn was stopped manually.');
});

test('English fallback for a completed turn without text is localized', () => {
  const notification = buildTurnNotification(
    session,
    turnEnd(),
    { ...state, lastText: '' },
    { locale: 'en' },
  );
  assert.equal(notification.body, 'The turn completed, but its final message had no text.');
});
