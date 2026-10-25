export const PROJECTION_KEY = 'dshTurnNotifier';

/** Extract only user-visible text; reasoning and tool-call blocks are not message text. */
export function assistantText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function initialState() {
  return {
    turn: null,
    lastText: '',
    hasMessage: false,
    messageSeq: null,
  };
}

const stateSchema = {
  parse(value) {
    if (typeof value !== 'object' || value === null) {
      throw new TypeError('turn notification state must be an object');
    }
    if (value.turn !== null && (!Number.isSafeInteger(value.turn) || value.turn < 0)) {
      throw new TypeError('turn notification state has an invalid turn');
    }
    if (typeof value.lastText !== 'string' || typeof value.hasMessage !== 'boolean') {
      throw new TypeError('turn notification state has invalid message fields');
    }
    if (value.messageSeq !== null && (!Number.isSafeInteger(value.messageSeq) || value.messageSeq < 0)) {
      throw new TypeError('turn notification state has an invalid message sequence');
    }
    return value;
  },
};

/**
 * Keep only the current turn's final assistant message. The framework replays
 * the durable log when necessary, including when the plugin loads mid-turn.
 */
export function createTurnProjection() {
  return {
    key: PROJECTION_KEY,
    stateVersion: 1,
    stateSchema,
    init: initialState,
    apply(state, event) {
      if (event.type === 'turn/start') {
        return { ...initialState(), turn: event.data.turn };
      }
      if (event.type !== 'assistant/message') return state;

      // Replacing the whole state also prevents an older turn's text from
      // leaking through if a partial log lacks its turn/start marker.
      return {
        turn: event.data.turn,
        lastText: assistantText(event.data.message),
        hasMessage: true,
        messageSeq: event.seq,
      };
    },
  };
}
