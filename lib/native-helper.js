import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const DEFAULT_POLL_MS = 300;
const START_TIMEOUT_MS = 5_000;

function helperError(code, message) {
  return Object.assign(new Error(message), { code });
}

function pidIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

/**
 * Host-side adapter for the legacy NSUserNotification helper. The profile
 * directory is the authenticated local channel: Host writes requests, helper
 * writes actions, and both files are private to the profile.
 */
export class NativeHelper {
  constructor(options) {
    this.dataDir = options.dataDir;
    this.appPath = options.appPath;
    this.deploymentId = options.deploymentId;
    this.launch = options.launch ?? this.openApplication.bind(this);
    this.pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    this.started = false;
    this.timer = undefined;
    this.actionOffset = 0;
    this.onAction = undefined;
    this.requestsDir = join(this.dataDir, 'helper-requests');
    this.actionsPath = join(this.dataDir, 'helper-actions.ndjson');
    this.pidPath = join(this.dataDir, 'helper.pid');
  }

  async openApplication() {
    // Launch the bundle executable directly. `open -n` can reuse a running
    // instance of the same app (including one from an older profile), which
    // would leave this profile without a helper pid.
    const executable = join(this.appPath, 'Contents', 'MacOS', 'DSHNativeNotifier');
    const child = spawn(executable, [
      '--data-dir',
      this.dataDir,
      '--deployment',
      this.deploymentId,
    ], { detached: true, stdio: 'ignore' });
    child.unref();
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('spawn', resolve);
    });
  }

  async diagnostic(message) {
    try {
      await appendFile(join(this.dataDir, 'native-helper-start.log'), `${message}\n`, { mode: 0o600 });
    } catch (_error) {
      // Diagnostics are best effort.
    }
  }

  async start() {
    if (this.started) return true;
    if (this.dataDir === undefined || this.appPath === undefined) return false;
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    await mkdir(this.requestsDir, { recursive: true, mode: 0o700 });
    try {
      const pid = JSON.parse(await readFile(this.pidPath, 'utf8'));
      if (pidIsAlive(pid?.pid) && pid.deploymentId === this.deploymentId) {
        this.started = true;
        this.startPolling();
        return true;
      }
    } catch (_error) {
      // No live pid record; launch a fresh helper below.
    }
    await rm(this.pidPath, { force: true }).catch(() => {});
    try {
      await this.launch();
    } catch (error) {
      await this.diagnostic(`launch-failed code=${error?.code ?? 'unknown'} path=${this.appPath}`);
      return false;
    }
    const deadline = Date.now() + START_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const pid = JSON.parse(await readFile(this.pidPath, 'utf8'));
        if (pidIsAlive(pid?.pid)) {
          this.started = true;
          this.startPolling();
          return true;
        }
      } catch (_error) {
        // Helper has not written its pid yet.
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    await this.diagnostic('pid-timeout');
    return false;
  }

  startPolling() {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => {
      void this.poll().catch(() => {});
    }, this.pollMs);
    this.timer.unref?.();
  }

  async show(notification) {
    if (!this.started) throw helperError('HELPER_NOT_RUNNING', 'native helper is not running');
    const request = {
      type: 'notify',
      notificationId: notification.notificationId,
      title: notification.title,
      subtitle: notification.subtitle,
      body: notification.body,
      sound: notification.soundName,
    };
    await writeFile(join(this.requestsDir, `${randomUUID()}.json`), JSON.stringify(request), {
      mode: 0o600,
      flag: 'wx',
    });
  }

  async poll() {
    let data;
    try {
      data = await readFile(this.actionsPath, 'utf8');
    } catch (_error) {
      return;
    }
    if (data.length < this.actionOffset) this.actionOffset = 0;
    let start = this.actionOffset;
    let newline;
    while ((newline = data.indexOf('\n', start)) !== -1) {
      const line = data.slice(start, newline);
      start = newline + 1;
      if (line.length === 0) continue;
      let action;
      try {
        action = JSON.parse(line);
      } catch (_error) {
        continue;
      }
      if (action?.protocolVersion !== 1 || action.deploymentId !== this.deploymentId) continue;
      if (typeof action.notificationId !== 'string' || action.kind !== 'open') continue;
      this.onAction?.({
        notificationId: action.notificationId,
        kind: 'open',
      });
    }
    this.actionOffset = start;
    // Consume action observations promptly; they are local protocol state,
    // not a long-lived log. A concurrent action can only arrive from a click.
    if (data.length > 0) await writeFile(this.actionsPath, '', { mode: 0o600 });
    this.actionOffset = 0;
  }

  /** Register the single Host consumer for helper actions. */
  setActionHandler(handler) {
    this.onAction = handler;
  }

  async close() {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!this.started) return;
    this.started = false;
    try {
      await writeFile(join(this.requestsDir, 'stop.json'), '{"type":"stop"}', {
        mode: 0o600,
        flag: 'wx',
      });
    } catch (_error) {
      // The helper may already be gone; its pid file is stale-detected.
    }
  }
}

export function createNativeHelper(options) {
  return new NativeHelper(options);
}
