import { ActionRouter } from './lib/action-router.js';
import { describeError } from './lib/diagnostics.js';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSettings } from './lib/notification.js';
import { createNotificationRegistry } from './lib/notification-registry.js';
import { showMacOSNotification } from './lib/macos-notifier.js';
import { createNativeHelper } from './lib/native-helper.js';
import { TurnNotifierActions } from './lib/remote.js';
import { startTurnNotifier } from './lib/turn-notifier.js';

export const inject = ['sessionProjections', 'agents'];

// Async apply: the plugin fiber owns the projection registration and releases
// it on unload, so nothing is returned here.
export async function apply(ctx, config = {}) {
  const settings = normalizeSettings(config);
  if (!settings.enabled) return;
  if (process.platform !== 'darwin') {
    ctx.logger.warn('[dsh-turn-notifier] this bundle currently supports macOS only');
    return;
  }

  const profileDir = process.env.DSH_PROFILE_DIR
    ?? (typeof ctx.get === 'function' ? ctx.get('profileContext')?.dir : undefined);
  let registry;
  try {
    registry = await createNotificationRegistry(
      profileDir === undefined ? {} : { dataDir: join(profileDir, '.turn-notifier') },
    );
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => () => registry.close());
    }
  } catch (error) {
    // A locked or unreadable profile must not take the basic completion
    // notification down with it; actions become unavailable in this run.
    ctx.logger.warn(`[dsh-turn-notifier] notification registry unavailable: ${describeError(error)}`);
  }

  // The generated ./remote contribution addresses this service through the
  // Typert Gateway; the service itself exposes the A3 action router.
  const router = new ActionRouter({ registry });
  ctx.plugin(TurnNotifierActions, { router });

  let native;
  if (registry !== undefined) {
    native = createNativeHelper({
      dataDir: registry.dataDir,
      appPath: fileURLToPath(new URL('./native/DSHNativeNotifier.app', import.meta.url)),
      deploymentId: registry.deploymentId,
    });
    native.setActionHandler((action) => {
      const queued = router.enqueue(action);
      if (!queued.ok) {
        ctx.logger.warn(`[dsh-turn-notifier] native action rejected: code=${queued.code}`);
      }
    });
    const ready = await native.start();
    if (ready) {
      ctx.effect(() => () => native.close());
    } else {
      ctx.logger.warn('[dsh-turn-notifier] native helper unavailable; falling back to the AppleScript notifier');
      native = undefined;
    }
  }

  await startTurnNotifier(ctx, settings, {
    notify: native === undefined
      ? showMacOSNotification
      : (notification) => native.show(notification),
    registry,
  });
}
