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
    if (typeof value.hasMessage !== 'boolean') {
      throw new TypeError('turn notification state has invalid message fields');
    }
    if (value.messageSeq !== null && (!Number.isSafeInteger(value.messageSeq) || value.messageSeq < 0)) {
      throw new TypeError('turn notification state has an invalid message sequence');
    }
    if (value.hasMessage !== (value.messageSeq !== null)) {
      throw new TypeError('turn notification state has inconsistent message fields');
    }
    return { turn: value.turn, hasMessage: value.hasMessage, messageSeq: value.messageSeq };
  },
};

/**
 * Track where the current turn's final assistant message sits in the log:
 * its turn and seq, never its text. Harness checkpoints every projection state
 * to disk, so the reply text is read on demand at notification time instead
 * (see `harness-adapter.js`). The framework replays the durable log when
 * necessary, including when the plugin loads mid-turn.
 *
 * `stateVersion` 2 dropped the `lastText` field of version 1; Harness discards
 * cached rows whose version does not match and rewrites a session's cache
 * record the next time it checkpoints that session.
 */
export function createTurnProjection() {
  return {
    key: PROJECTION_KEY,
    stateVersion: 2,
    stateSchema,
    init: initialState,
    apply(state, event) {
      if (event.type === 'turn/start') {
        return { ...initialState(), turn: event.data.turn };
      }
      if (event.type !== 'assistant/message') return state;

      // Replacing the whole state also prevents an older turn's message from
      // being matched if a partial log lacks its turn/start marker.
      return {
        turn: event.data.turn,
        hasMessage: true,
        messageSeq: event.seq,
      };
    },
  };
}

/**
 * Register the turn projection and return a synchronous state reader.
 *
 * Harness 0.2.1-rc.2 and later resolve `register()` to a handle whose
 * `stateOf(session)` is the supported read. Its runtime value is a callable
 * thenable, so it is awaited rather than checked with `instanceof Promise`.
 * Older registries return a plain disposer and only offer the now-deprecated
 * `registry.stateOf(session, key)`, which stays as a fallback. The fiber that
 * calls this owns the registration and releases it on unload; the result must
 * not be returned from an async `apply` or used as an effect cleanup.
 * Registration errors reject.
 *
 * @param registry - the injected `ctx.sessionProjections` service.
 * @returns {Promise<(session: object) => unknown>} reads this projection's state.
 */
export async function registerTurnProjection(registry) {
  const definition = createTurnProjection();
  const registration = await registry.register(definition);
  if (typeof registration?.stateOf === 'function') {
    return (session) => registration.stateOf(session);
  }
  if (typeof registry.stateOf === 'function') {
    return (session) => registry.stateOf(session, definition.key);
  }
  throw Object.assign(new Error('session projection registry offers no state reader'), {
    code: 'UNSUPPORTED_PROJECTION_API',
  });
}
