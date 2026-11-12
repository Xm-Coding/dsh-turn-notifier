import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const REGISTRY_PROTOCOL_VERSION = 1;
export const DEFAULT_RECORD_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const DEFAULT_MAX_RECORDS = 4_096;

const VALID_REASON_KINDS = new Set(['completed', 'max-tokens', 'error', 'aborted']);
const DELIVERY_STATES = new Set(['created', 'submitted', 'failed', 'unknown']);

function registryError(code, message) {
  return Object.assign(new Error(message), { code });
}

/** Resolve the profile-owned data directory without writing anything. */
export function defaultDataDir(environment = process.env) {
  if (environment.DSH_PROFILE_DIR) return join(environment.DSH_PROFILE_DIR, '.turn-notifier');
  const home = environment.DSH_HOME || join(homedir(), '.dsh');
  const profile = environment.DSH_PROFILE || 'default';
  return join(home, 'profiles', profile, '.turn-notifier');
}

function isPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== 'ESRCH';
  }
}

function validRecord(value) {
  return typeof value === 'object'
    && value !== null
    && value.protocolVersion === REGISTRY_PROTOCOL_VERSION
    && typeof value.notificationId === 'string'
    && typeof value.route === 'object'
    && value.route !== null
    && typeof value.route.deploymentId === 'string'
    && typeof value.route.sessionId === 'string'
    && Number.isSafeInteger(value.route.sessionCreatedAt)
    && Number.isSafeInteger(value.turn)
    && Number.isSafeInteger(value.eventSeq)
    && (value.messageSeq === null || Number.isSafeInteger(value.messageSeq))
    && VALID_REASON_KINDS.has(value.reasonKind)
    && Number.isSafeInteger(value.createdAt)
    && Number.isSafeInteger(value.expiresAt)
    && DELIVERY_STATES.has(value.delivery);
}

/**
 * Capture the immutable route and turn identity synchronously in a
 * `session/event` listener. The returned object contains no body text.
 */
export function captureNotificationInput(session, event, state) {
  const sessionId = session?.id;
  const sessionCreatedAt = session?.header?.createdAt;
  const turn = event?.data?.turn;
  const reasonKind = event?.data?.reason?.kind;
  if (typeof sessionId !== 'string' || !Number.isSafeInteger(sessionCreatedAt)) {
    throw registryError('SESSION_IDENTITY_UNAVAILABLE', 'session identity is unavailable');
  }
  if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(event?.seq)) {
    throw registryError('TURN_IDENTITY_UNAVAILABLE', 'turn identity is unavailable');
  }
  if (!VALID_REASON_KINDS.has(reasonKind)) {
    throw registryError('TURN_REASON_UNAVAILABLE', 'turn reason is unavailable');
  }
  return {
    route: { sessionId, sessionCreatedAt },
    turn,
    eventSeq: event.seq,
    messageSeq: state?.turn === turn && state.hasMessage === true ? state.messageSeq : null,
    reasonKind,
  };
}

async function atomicWrite(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await rename(temporary, path);
}

/**
 * Persistent notification route registry. The deployment identity is stable
 * per profile; one live process owns it through a lock. Route records are the
 * authority for native callbacks and contain no notification body.
 */
export class NotificationRegistry {
  constructor(options = {}) {
    this.dataDir = options.dataDir ?? defaultDataDir();
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? randomUUID;
    this.ttlMs = options.ttlMs ?? DEFAULT_RECORD_TTL_MS;
    this.maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS;
    this.records = new Map();
    this.deploymentId = undefined;
    this.instanceId = undefined;
    this.lockPath = join(this.dataDir, 'instance.lock');
    this.deploymentPath = join(this.dataDir, 'deployment.json');
    this.recordsPath = join(this.dataDir, 'records.json');
    this.lockHandle = undefined;
    this.opened = false;
  }

  async open() {
    if (this.opened) return this;
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    this.instanceId = this.newId();
    await this.acquireLock();
    try {
      this.deploymentId = await this.loadDeployment();
      await this.loadRecords();
      this.opened = true;
      return this;
    } catch (error) {
      await this.releaseLock();
      throw error;
    }
  }

  async acquireLock() {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        this.lockHandle = await open(this.lockPath, 'wx', 0o600);
        await this.lockHandle.writeFile(JSON.stringify({
          pid: process.pid,
          startedAt: this.now(),
          instanceId: this.instanceId,
        }));
        return;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        let holder;
        try {
          holder = JSON.parse(await readFile(this.lockPath, 'utf8'));
        } catch (_readError) {
          holder = undefined;
        }
        if (holder !== undefined && isPidAlive(holder.pid)) {
          throw registryError('DEPLOYMENT_LOCKED', 'another live Harness process owns this notification registry');
        }
        await rm(this.lockPath, { force: true });
      }
    }
    throw registryError('DEPLOYMENT_LOCKED', 'could not acquire the notification registry lock');
  }

  async releaseLock() {
    if (this.lockHandle !== undefined) {
      await this.lockHandle.close().catch(() => {});
      this.lockHandle = undefined;
      await rm(this.lockPath, { force: true }).catch(() => {});
    }
  }

  async loadDeployment() {
    try {
      const value = JSON.parse(await readFile(this.deploymentPath, 'utf8'));
      if (typeof value?.deploymentId !== 'string' || value.deploymentId.length === 0) {
        throw new Error('invalid deployment identity');
      }
      return value.deploymentId;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        const quarantine = `${this.deploymentPath}.corrupt-${this.now()}`;
        await rename(this.deploymentPath, quarantine).catch(() => {});
      }
      const deploymentId = this.newId();
      await atomicWrite(this.deploymentPath, {
        protocolVersion: REGISTRY_PROTOCOL_VERSION,
        deploymentId,
      });
      return deploymentId;
    }
  }

  async loadRecords() {
    let raw;
    try {
      raw = JSON.parse(await readFile(this.recordsPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      const quarantine = `${this.recordsPath}.corrupt-${this.now()}`;
      await rename(this.recordsPath, quarantine).catch(() => {});
      return;
    }
    if (raw?.protocolVersion !== REGISTRY_PROTOCOL_VERSION || typeof raw.records !== 'object' || raw.records === null) {
      const quarantine = `${this.recordsPath}.corrupt-${this.now()}`;
      await rename(this.recordsPath, quarantine).catch(() => {});
      return;
    }
    const now = this.now();
    for (const [id, value] of Object.entries(raw.records)) {
      if (!validRecord(value) || value.notificationId !== id || value.expiresAt <= now) continue;
      this.records.set(id, value);
    }
    this.enforceLimit(now);
  }

  enforceLimit(now = this.now()) {
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(id);
    }
    if (this.records.size <= this.maxRecords) return;
    const oldest = [...this.records.entries()]
      .sort((left, right) => left[1].createdAt - right[1].createdAt)
      .slice(0, this.records.size - this.maxRecords);
    for (const [id] of oldest) this.records.delete(id);
  }

  async save() {
    const records = Object.fromEntries(this.records);
    await atomicWrite(this.recordsPath, {
      protocolVersion: REGISTRY_PROTOCOL_VERSION,
      records,
    });
  }

  async create(input) {
    if (!this.opened) throw registryError('REGISTRY_NOT_OPEN', 'notification registry is not open');
    const now = this.now();
    const notificationId = this.newId();
    const record = {
      protocolVersion: REGISTRY_PROTOCOL_VERSION,
      notificationId,
      route: {
        deploymentId: this.deploymentId,
        sessionId: input.route.sessionId,
        sessionCreatedAt: input.route.sessionCreatedAt,
      },
      turn: input.turn,
      eventSeq: input.eventSeq,
      messageSeq: input.messageSeq ?? null,
      reasonKind: input.reasonKind,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      delivery: 'created',
    };
    this.records.set(notificationId, record);
    this.enforceLimit(now);
    try {
      await this.save();
    } catch (error) {
      this.records.delete(notificationId);
      throw error;
    }
    return record;
  }

  get(notificationId) {
    const record = this.records.get(notificationId);
    if (record === undefined) return undefined;
    if (record.expiresAt <= this.now()) {
      this.records.delete(notificationId);
      return undefined;
    }
    return record;
  }

  /**
   * Resolve a callback only through its notification ID. A supplied session
   * identity is checked against the persisted route; this never falls back to
   * the current or most recent session.
   */
  resolve(notificationId, session = undefined) {
    const record = this.get(notificationId);
    if (record === undefined) return { ok: false, code: 'notification/not-found' };
    if (session !== undefined) {
      if (session.id !== record.route.sessionId
        || session.header?.createdAt !== record.route.sessionCreatedAt) {
        return { ok: false, code: 'notification/identity-mismatch' };
      }
    }
    return { ok: true, record };
  }

  async markDelivery(notificationId, delivery) {
    if (!DELIVERY_STATES.has(delivery)) throw registryError('INVALID_DELIVERY_STATE', 'invalid delivery state');
    const record = this.records.get(notificationId);
    if (record === undefined) return undefined;
    record.delivery = delivery;
    await this.save();
    return record;
  }



  list() {
    this.enforceLimit();
    return [...this.records.values()];
  }

  async close() {
    if (!this.opened) return;
    this.opened = false;
    this.records.clear();
    await this.releaseLock();
  }
}

export async function createNotificationRegistry(options = {}) {
  const registry = new NotificationRegistry(options);
  await registry.open();
  return registry;
}
