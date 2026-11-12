import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assistantText,
  createTurnProjection,
  PROJECTION_KEY,
  registerTurnProjection,
} from '../lib/projection.js';

/** Harness's register() result: callable (deprecated disposer) and awaitable. */
function callableThenable(settled) {
  const registration = () => {};
  registration.then = (onFulfilled, onRejected) => settled.then(onFulfilled, onRejected);
  return registration;
}

function assistantEvent(turn, seq, text, extraBlocks = []) {
  return {
    type: 'assistant/message',
    seq,
    data: {
      turn,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }, ...extraBlocks],
      },
    },
  };
}

test('assistantText ignores reasoning and tool calls', () => {
  assert.equal(assistantText({
    content: [
      { type: 'reasoning', text: 'private reasoning' },
      { type: 'text', text: '第一段' },
      { type: 'tool-call', name: 'bash' },
      { type: 'text', text: '第二段' },
    ],
  }), '第一段\n第二段');
});

test('projection records where the current turn\'s final assistant message is', () => {
  const projection = createTurnProjection();
  let state = projection.init();
  state = projection.apply(state, { type: 'turn/start', data: { turn: 4 } });
  state = projection.apply(state, assistantEvent(4, 10, '先调用工具', [
    { type: 'tool-call', name: 'bash' },
  ]));
  state = projection.apply(state, assistantEvent(4, 20, '这是最终回复'));

  assert.deepEqual(state, {
    turn: 4,
    hasMessage: true,
    messageSeq: 20,
  });

  const ended = projection.apply(state, {
    type: 'turn/end',
    data: { turn: 4, reason: { kind: 'completed' } },
  });
  assert.equal(ended, state);

  const next = projection.apply(ended, { type: 'turn/start', data: { turn: 5 } });
  assert.deepEqual(next, { turn: 5, hasMessage: false, messageSeq: null });
});

test('projection state never holds message text', () => {
  const projection = createTurnProjection();
  const SENTINEL = 'SENTINEL-缓存-5a0c';
  let state = projection.init();
  state = projection.apply(state, { type: 'turn/start', data: { turn: 1 } });
  state = projection.apply(state, assistantEvent(1, 3, SENTINEL));
  assert.equal(projection.stateVersion, 2);
  assert.ok(!JSON.stringify(state).includes(SENTINEL));
});

test('projection does not reuse an older turn after a partial log', () => {
  const projection = createTurnProjection();
  let state = projection.init();
  state = projection.apply(state, assistantEvent(1, 1, '旧回复'));
  state = projection.apply(state, assistantEvent(2, 2, '新回复'));
  assert.equal(state.turn, 2);
  assert.equal(state.messageSeq, 2);
});

test('projection state schema validates restored cache data', () => {
  const projection = createTurnProjection();
  assert.deepEqual(projection.stateSchema.parse(projection.init()), projection.init());
  assert.throws(() => projection.stateSchema.parse({ turn: -1 }), /invalid|fields/);
  assert.throws(
    () => projection.stateSchema.parse({ turn: 1, hasMessage: true, messageSeq: null }),
    /inconsistent/,
  );
  // A version-1 shaped value keeps only the version-2 fields.
  assert.deepEqual(
    projection.stateSchema.parse({ turn: 1, lastText: '旧正文', hasMessage: true, messageSeq: 7 }),
    { turn: 1, hasMessage: true, messageSeq: 7 },
  );
});

test('registerTurnProjection reads through the registration handle', async () => {
  const session = { id: 'session-1' };
  let registered;
  const registry = {
    register(definition) {
      registered = definition;
      return callableThenable(Promise.resolve({
        stateOf: (target) => (target === session ? 'handle-state' : undefined),
      }));
    },
    stateOf() {
      throw new Error('deprecated registry-level read was used');
    },
  };

  const readState = await registerTurnProjection(registry);
  assert.equal(registered.key, PROJECTION_KEY);
  assert.equal(registered.stateVersion, 2);
  assert.equal(readState(session), 'handle-state');
});

test('registerTurnProjection falls back to the legacy registry read', async () => {
  const keys = [];
  const registry = {
    register: () => () => {},
    stateOf(session, key) {
      keys.push(key);
      return `legacy-state:${session.id}`;
    },
  };

  const readState = await registerTurnProjection(registry);
  assert.equal(readState({ id: 'session-1' }), 'legacy-state:session-1');
  assert.deepEqual(keys, [PROJECTION_KEY]);
});

test('registerTurnProjection rejects failed registrations and unknown registries', async () => {
  await assert.rejects(
    registerTurnProjection({ register: () => callableThenable(Promise.reject(new Error('key conflict'))) }),
    /key conflict/,
  );
  await assert.rejects(
    registerTurnProjection({ register: () => () => {} }),
    { code: 'UNSUPPORTED_PROJECTION_API' },
  );
});
