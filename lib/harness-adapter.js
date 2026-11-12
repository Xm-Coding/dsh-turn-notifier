/**
 * Reads from Harness services other than the projection registry.
 *
 * Every service here is optional: `ctx.get(name)` returns `undefined` when a
 * composition does not mount it, and callers fall back instead of failing.
 */
import { assistantText } from './projection.js';

/** Upper bound for one on-demand message read; a live session answers from memory. */
const MESSAGE_READ_TIMEOUT_MS = 5_000;

function optionalService(ctx, name) {
  return typeof ctx.get === 'function' ? ctx.get(name) : undefined;
}

function adapterError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Read the user-visible text of one assistant message by its log position.
 *
 * Uses `ctx.sessionQuery.readEvent`, the asynchronous history read Harness
 * offers Host plugins; synchronous `Session.eventAt()` and `snapshotEvents()`
 * are deprecated for new callers. The event must still be the `assistant/message`
 * of `turn` at `messageSeq`; nothing falls back to another message.
 *
 * @param ctx - plugin context.
 * @param sessionId - Harness session id.
 * @param position - `{ turn, messageSeq }` captured when the turn ended.
 * @returns {Promise<string>} the message's text blocks joined by newlines (may be empty).
 * @throws code `SESSION_QUERY_UNAVAILABLE` or `MESSAGE_MISMATCH`, or the query's own failure.
 */
export async function readAssistantTextAt(ctx, sessionId, { turn, messageSeq }) {
  const sessionQuery = optionalService(ctx, 'sessionQuery');
  if (typeof sessionQuery?.readEvent !== 'function') {
    throw adapterError('SESSION_QUERY_UNAVAILABLE', 'ctx.sessionQuery is not mounted');
  }
  const { target } = await sessionQuery.readEvent(
    { sessionId, seq: messageSeq },
    AbortSignal.timeout(MESSAGE_READ_TIMEOUT_MS),
  );
  if (target?.seq !== messageSeq || target.type !== 'assistant/message' || target.data?.turn !== turn) {
    throw adapterError('MESSAGE_MISMATCH', 'the event at the recorded seq is not this turn\'s assistant message');
  }
  return assistantText(target.data.message);
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readOptional(read) {
  try {
    return nonEmptyString(read());
  } catch (_error) {
    // Presentation is best effort: a failing title or directory read must not
    // suppress the notification, and the caller has a fallback for each field.
    return undefined;
  }
}

/**
 * Read display-only facts about a session. These never identify the session
 * for routing; they only label the notification.
 *
 * @param ctx - plugin context.
 * @param session - live Harness session.
 * @returns {{ title?: string, directory?: string }} the latest session title
 *   (`ctx.sessionTitle`) and the current working directory
 *   (`ctx.workingDirectory`, falling back to the header's initial `cwd`).
 */
export function readSessionPresentation(ctx, session) {
  const title = readOptional(() => optionalService(ctx, 'sessionTitle')?.get(session)?.title);
  const directory = readOptional(() => optionalService(ctx, 'workingDirectory')?.get(session))
    ?? nonEmptyString(session.header?.cwd);
  return {
    ...(title === undefined ? {} : { title }),
    ...(directory === undefined ? {} : { directory }),
  };
}
