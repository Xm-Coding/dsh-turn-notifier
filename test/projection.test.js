import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantText, createTurnProjection } from '../lib/projection.js';

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

test('projection keeps the final assistant message of the current turn only', () => {
  const projection = createTurnProjection();
  let state = projection.init();
  state = projection.apply(state, { type: 'turn/start', data: { turn: 4 } });
  state = projection.apply(state, assistantEvent(4, 10, '先调用工具', [
    { type: 'tool-call', name: 'bash' },
  ]));
  state = projection.apply(state, assistantEvent(4, 20, '这是最终回复'));

  assert.deepEqual(state, {
    turn: 4,
    lastText: '这是最终回复',
    hasMessage: true,
    messageSeq: 20,
  });

  const ended = projection.apply(state, {
    type: 'turn/end',
    data: { turn: 4, reason: { kind: 'completed' } },
  });
  assert.equal(ended, state);

  const next = projection.apply(ended, { type: 'turn/start', data: { turn: 5 } });
  assert.equal(next.lastText, '');
  assert.equal(next.hasMessage, false);
  assert.equal(next.turn, 5);
});

test('projection does not reuse an older turn after a partial log', () => {
  const projection = createTurnProjection();
  let state = projection.init();
  state = projection.apply(state, assistantEvent(1, 1, '旧回复'));
  state = projection.apply(state, assistantEvent(2, 2, '新回复'));
  assert.equal(state.turn, 2);
  assert.equal(state.lastText, '新回复');
});

test('projection state schema validates restored cache data', () => {
  const projection = createTurnProjection();
  assert.deepEqual(projection.stateSchema.parse(projection.init()), projection.init());
  assert.throws(() => projection.stateSchema.parse({ turn: -1 }), /invalid|fields/);
});
