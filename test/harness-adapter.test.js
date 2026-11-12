import test from 'node:test';
import assert from 'node:assert/strict';
import { readAssistantTextAt, readSessionPresentation } from '../lib/harness-adapter.js';

function contextWith(services) {
  return { get: (name) => services[name] };
}

function assistantEvent(turn, seq, content) {
  return { type: 'assistant/message', seq, data: { turn, message: { role: 'assistant', content } } };
}

function queryReturning(target, requests = []) {
  return {
    async readEvent(request, signal) {
      requests.push({ request, signal });
      return { target, events: [target] };
    },
  };
}

test('reads the text blocks of the recorded assistant message', async () => {
  const requests = [];
  const ctx = contextWith({
    sessionQuery: queryReturning(assistantEvent(3, 41, [
      { type: 'reasoning', text: '不显示' },
      { type: 'text', text: '最终回复' },
    ]), requests),
  });

  const text = await readAssistantTextAt(ctx, 'session-1', { turn: 3, messageSeq: 41 });
  assert.equal(text, '最终回复');
  assert.deepEqual(requests[0].request, { sessionId: 'session-1', seq: 41 });
  assert.ok(requests[0].signal instanceof AbortSignal);
});

test('refuses an event that is not this turn\'s assistant message', async () => {
  const cases = [
    { type: 'user/message', seq: 41, data: { turn: 3 } },
    assistantEvent(2, 41, [{ type: 'text', text: '上一轮' }]),
    assistantEvent(3, 40, [{ type: 'text', text: '错位' }]),
    undefined,
  ];
  for (const target of cases) {
    const ctx = contextWith({ sessionQuery: queryReturning(target) });
    await assert.rejects(
      readAssistantTextAt(ctx, 'session-1', { turn: 3, messageSeq: 41 }),
      { code: 'MESSAGE_MISMATCH' },
    );
  }
});

test('reports a missing sessionQuery service', async () => {
  for (const ctx of [contextWith({}), {}]) {
    await assert.rejects(
      readAssistantTextAt(ctx, 'session-1', { turn: 1, messageSeq: 1 }),
      { code: 'SESSION_QUERY_UNAVAILABLE' },
    );
  }
});

test('passes query failures through', async () => {
  const failure = Object.assign(new Error('no event'), { code: 'SESSION_QUERY_EVENT_NOT_FOUND' });
  const ctx = contextWith({ sessionQuery: { readEvent: async () => { throw failure; } } });
  await assert.rejects(readAssistantTextAt(ctx, 'session-1', { turn: 1, messageSeq: 1 }), failure);
});

const session = { id: 'session-1', header: { cwd: '/Users/example/initial-project' } };

test('presentation reads the session title and the current directory', () => {
  const ctx = contextWith({
    sessionTitle: { get: (target) => (target === session ? { title: '修复通知插件', eventSeq: 3 } : undefined) },
    workingDirectory: { get: () => '/Users/example/moved-project' },
  });
  assert.deepEqual(readSessionPresentation(ctx, session), {
    title: '修复通知插件',
    directory: '/Users/example/moved-project',
  });
});

test('presentation falls back to the initial directory and omits missing titles', () => {
  for (const services of [
    {},
    { sessionTitle: { get: () => undefined }, workingDirectory: { get: () => '' } },
    { sessionTitle: { get: () => ({ title: '   ' }) } },
    {
      sessionTitle: { get: () => { throw new Error('title read failed'); } },
      workingDirectory: { get: () => { throw new Error('directory read failed'); } },
    },
  ]) {
    assert.deepEqual(readSessionPresentation(contextWith(services), session), {
      directory: '/Users/example/initial-project',
    });
  }
  assert.deepEqual(readSessionPresentation({}, { id: 'bare', header: {} }), {});
});
