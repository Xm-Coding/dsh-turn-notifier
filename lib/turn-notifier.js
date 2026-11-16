import { createDeliveryQueue } from './delivery-queue.js';
import { describeError } from './diagnostics.js';
import { readAssistantTextAt, readSessionPresentation } from './harness-adapter.js';
import { captureNotificationInput } from './notification-registry.js';
import { buildTurnNotification, turnStatus } from './notification.js';
import { registerTurnProjection } from './projection.js';

/** `turn/end` events held while the projection registration resolves. */
const MAX_PENDING_TURN_ENDS = 32;
/** Recently notified event keys kept for de-duplication. */
const MAX_NOTIFIED_KEYS = 512;

function isRootSession(agents, session) {
  // DSH 0.2.2-rc.3 removed `agents.roots()`; subagents are identified by the
  // durable Session header. Keep the old registry path for older hosts.
  if (typeof agents?.roots === 'function') {
    const agent = agents.get(session.id);
    return agent !== undefined && agents.roots().includes(agent);
  }
  return session.header?.origin !== 'subagent';
}

/**
 * Notify once per qualifying committed `turn/end`.
 *
 * Inside the listener, everything that identifies the turn is captured
 * synchronously: the projection's message position and the session's title and
 * directory. Only then does delivery go asynchronous, so a turn that starts
 * meanwhile cannot change what this notification shows. The reply text is read
 * by its recorded seq; if that read fails the notification falls back to
 * status-only text instead of being dropped.
 *
 * The `session/event` listener is installed before the projection registration
 * settles; a turn that ends during that wait is held (up to
 * {@link MAX_PENDING_TURN_ENDS}) and handled once the reader is ready.
 * Failures are logged by category only.
 *
 * @param ctx - plugin context providing `sessionProjections`, `agents`, `on`,
 *   `logger`, and `get` for the optional `sessionQuery`, `sessionTitle`, and
 *   `workingDirectory` services.
 * @param settings - output of `normalizeSettings`.
 * @param deps.notify - sends one notification; transient failures are retried
 *   by the bounded delivery queue.
 * @param deps.registry - optional persistent notification route registry.
 * @param deps.deliveryOptions - optional queue overrides, mainly for tests.
 * @returns {Promise<void>} settles once the reader is ready; rejects, dropping
 *   held events, when projection registration fails.
 */
export async function startTurnNotifier(ctx, settings, { notify, registry, deliveryOptions = {} }) {
  let readState;
  let pending = [];
  const notified = new Set();
  const deliveries = createDeliveryQueue({
    ...deliveryOptions,
    onDrop: (drop) => {
      ctx.logger.warn(`[dsh-turn-notifier] delivery dropped: reason=${drop.reason}`);
    },
  });

  // The plugin fiber owns the queue; unload cancels retry timers and queued
  // deliveries. An already-running applet is allowed to settle, but it will not
  // be restarted after disposal.
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => deliveries.dispose());
  }

  async function deliver(session, event, status, state, presentation, getRecord) {
    const turn = event.data?.turn;
    const record = getRecord === undefined ? null : await getRecord();
    let finalMessage = null;
    const hasFinalMessage = state?.turn === turn && state.hasMessage === true;
    if (settings.includeMessage && status.preview === 'reply' && hasFinalMessage) {
      try {
        const lastText = await readAssistantTextAt(ctx, session.id, { turn, messageSeq: state.messageSeq });
        finalMessage = { turn, hasMessage: true, lastText };
      } catch (error) {
        ctx.logger.warn(
          `[dsh-turn-notifier] reply preview unavailable for session ${session.id}, turn ${turn}: ${describeError(error)}`,
        );
      }
    }
    const notification = buildTurnNotification(session, event, finalMessage, settings, presentation);
    if (record !== null && record !== undefined) notification.notificationId = record.notificationId;
    try {
      await notify(notification);
      if (record !== null && record !== undefined) {
        await registry.markDelivery(record.notificationId, 'submitted').catch((error) => {
          ctx.logger.warn(`[dsh-turn-notifier] delivery state write failed: ${describeError(error)}`);
        });
      }
    } catch (error) {
      if (record !== null && record !== undefined) {
        await registry.markDelivery(record.notificationId, 'failed').catch(() => {});
      }
      throw error;
    }
  }

  function handleTurnEnd(session, event) {
    try {
      if (!settings.includeSubagents && !isRootSession(ctx.agents, session)) return;

      const status = turnStatus(event.data?.reason, settings);
      if (!status) return;

      const turn = event.data?.turn;
      const key = `${session.id}:${turn}:${event.seq}`;
      if (notified.has(key)) return;

      const state = readState(session);
      const presentation = readSessionPresentation(ctx, session);
      let routeInput;
      if (registry !== undefined) {
        try {
          routeInput = captureNotificationInput(session, event, state);
        } catch (error) {
          ctx.logger.warn(`[dsh-turn-notifier] route identity unavailable for session ${session.id}, turn ${event.data?.turn}: ${describeError(error)}`);
        }
      }
      let recordPromise;
      const getRecord = registry !== undefined && routeInput !== undefined
        ? () => {
            recordPromise ??= registry.create(routeInput).catch((error) => {
              ctx.logger.warn(`[dsh-turn-notifier] notification record failed for session ${session.id}, turn ${event.data?.turn}: ${describeError(error)}`);
              return null;
            });
            return recordPromise;
          }
        : undefined;

      notified.add(key);
      if (notified.size > MAX_NOTIFIED_KEYS) notified.delete(notified.values().next().value);

      deliveries.enqueue(key, () => deliver(session, event, status, state, presentation, getRecord), {
        onFailure({ error, attempts }) {
          ctx.logger.warn(
            `[dsh-turn-notifier] notification failed for session ${session.id}, turn ${turn} after ${attempts} attempts: ${describeError(error)}`,
          );
        },
      });
    } catch (error) {
      ctx.logger.warn(`[dsh-turn-notifier] turn listener failed: ${describeError(error)}`);
    }
  }

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return;
    if (readState !== undefined) handleTurnEnd(session, event);
    else if (pending !== undefined && pending.length < MAX_PENDING_TURN_ENDS) pending.push([session, event]);
  });

  try {
    readState = await registerTurnProjection(ctx.sessionProjections);
  } finally {
    const held = pending;
    pending = undefined;
    if (readState !== undefined) {
      for (const [session, event] of held) handleTurnEnd(session, event);
    }
  }
}
