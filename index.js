import { createTurnProjection, PROJECTION_KEY } from './lib/projection.js';
import { buildTurnNotification, normalizeSettings } from './lib/notification.js';
import { showMacOSNotification } from './lib/macos-notifier.js';

export const inject = ['sessionProjections', 'agents'];

function isRootSession(ctx, session) {
  const agent = ctx.agents.get(session.id);
  return agent !== undefined && ctx.agents.roots().includes(agent);
}

export function apply(ctx, config = {}) {
  const settings = normalizeSettings(config);
  if (!settings.enabled) return;
  if (process.platform !== 'darwin') {
    ctx.logger.warn('[dsh-turn-notifier] this bundle currently supports macOS only');
    return;
  }

  ctx.sessionProjections.register(createTurnProjection());
  const notified = new Set();

  ctx.on('session/event', (session, event) => {
    if (event.type !== 'turn/end') return;
    try {
      if (!settings.includeSubagents && !isRootSession(ctx, session)) return;

      const turn = event.data?.turn;
      const key = `${session.id}:${turn}:${event.seq}`;
      if (notified.has(key)) return;

      const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY);
      const notification = buildTurnNotification(session, event, state, settings);
      if (!notification) return;

      notified.add(key);
      if (notified.size > 512) notified.delete(notified.values().next().value);

      // Do not block the agent loop on AppleScript or a permission prompt.
      void showMacOSNotification(notification).catch((error) => {
        ctx.logger.warn(
          `[dsh-turn-notifier] notification failed for session ${session.id}, turn ${turn}: ${String(error)}`,
        );
      });
    } catch (error) {
      ctx.logger.warn(`[dsh-turn-notifier] turn listener failed: ${String(error)}`);
    }
  });
}
