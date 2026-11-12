import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_NOTIFIER = fileURLToPath(
  new URL('../native/AppleScriptNotifier.app/Contents/MacOS/applet', import.meta.url),
);

function argument(value) {
  return String(value ?? '').replaceAll('\0', '');
}

/**
 * The applet reads these four positional arguments through NSProcessInfo.
 * Message text never becomes AppleScript source, so quotes and code in a model
 * response remain inert notification text.
 */
export function buildNotifierArguments(notification) {
  const args = [
    argument(notification.title),
    argument(notification.subtitle),
    argument(notification.body),
    argument(notification.soundName),
  ];
  // The current AppleScript applet ignores this optional id; the native
  // helper added in B uses it to join notifications with Host records.
  if (typeof notification.notificationId === 'string' && notification.notificationId !== '') {
    args.push(argument(notification.notificationId));
  }
  return args;
}

export function defaultNotifierPath() {
  return DEFAULT_NOTIFIER;
}

function notifierError(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Show one notification through the bundled applet.
 * Rejections carry `code` (and, from `execFile`, `killed`/`signal`); log them
 * with `describeError` from `diagnostics.js`, never with `String(error)`,
 * because an `execFile` failure message contains the full argv.
 */
export async function showMacOSNotification(notification, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    throw notifierError('UNSUPPORTED_PLATFORM', `macOS notifications are unsupported on ${platform}`);
  }
  const notifierPath = options.notifierPath ?? DEFAULT_NOTIFIER;
  if (!existsSync(notifierPath)) {
    throw notifierError(
      'HELPER_MISSING',
      `notification helper is missing: ${notifierPath}; run native/build-macos-notifier.sh`,
    );
  }
  return execFileAsync(notifierPath, buildNotifierArguments(notification), {
    timeout: options.timeout ?? 10_000,
    maxBuffer: 64 * 1024,
    windowsHide: true,
  });
}
