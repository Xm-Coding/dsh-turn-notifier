import { randomUUID } from 'node:crypto';

export const DEFAULT_ACTION_LEASE_MS = 30_000;
export const DEFAULT_MAX_CLIENTS = 64;
export const DEFAULT_MAX_ACTIONS = 128;

function routerError(code, message) {
  return Object.assign(new Error(message), { code });
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function isGeneration(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function clientView(client) {
  return {
    clientId: client.clientId,
    generation: client.generation,
    sessionId: client.sessionId,
    focused: client.focused,
    capabilities: [...client.capabilities],
    lastSeen: client.lastSeen,
  };
}

/**
 * Host-owned action routing. Native callbacks enqueue an action; a Client
 * claims it under a short lease and reports the outcome. Only a Client that
 * registered with the current generation may claim or complete it.
 */
export class ActionRouter {
  constructor(options = {}) {
    this.registry = options.registry;
    this.now = options.now ?? (() => Date.now());
    this.newId = options.newId ?? randomUUID;
    this.leaseMs = options.leaseMs ?? DEFAULT_ACTION_LEASE_MS;
    this.maxClients = options.maxClients ?? DEFAULT_MAX_CLIENTS;
    this.maxActions = options.maxActions ?? DEFAULT_MAX_ACTIONS;
    this.clients = new Map();
    this.actions = new Map();
  }

  cleanup(now = this.now()) {
    for (const [id, client] of this.clients) {
      if (now - client.lastSeen > this.leaseMs * 4) this.clients.delete(id);
    }
    for (const [id, action] of this.actions) {
      if (action.expiresAt <= now) this.actions.delete(id);
    }
    if (this.actions.size > this.maxActions) {
      const oldest = [...this.actions.entries()]
        .sort((left, right) => left[1].createdAt - right[1].createdAt)
        .slice(0, this.actions.size - this.maxActions);
      for (const [id] of oldest) this.actions.delete(id);
    }
  }

  registerClient(request) {
    if (this.registry?.deploymentId === undefined || this.registry?.instanceId === undefined) {
      throw routerError('registry/unavailable', 'the notification registry is unavailable');
    }
    if (!isNonEmptyString(request?.clientId) || !isGeneration(request?.generation)) {
      throw routerError('client/invalid', 'clientId and a positive generation are required');
    }
    if (typeof request.sessionId !== 'string' || typeof request.focused !== 'boolean') {
      throw routerError('client/invalid', 'sessionId and focused are required');
    }
    if (!Array.isArray(request.capabilities) || request.capabilities.some((item) => typeof item !== 'string')) {
      throw routerError('client/invalid', 'capabilities must be a string array');
    }
    this.cleanup();
    const previous = this.clients.get(request.clientId);
    if (previous !== undefined && request.generation < previous.generation) {
      return {
        deploymentId: this.registry.deploymentId,
        instanceId: this.registry.instanceId,
        leaseMs: this.leaseMs,
        stale: true,
      };
    }
    const client = {
      clientId: request.clientId,
      generation: request.generation,
      sessionId: request.sessionId,
      focused: request.focused,
      capabilities: [...request.capabilities],
      lastSeen: this.now(),
    };
    this.clients.set(client.clientId, client);
    if (this.clients.size > this.maxClients) {
      const oldest = [...this.clients.entries()]
        .sort((left, right) => left[1].lastSeen - right[1].lastSeen)
        .slice(0, this.clients.size - this.maxClients);
      for (const [id] of oldest) this.clients.delete(id);
    }
    return {
      deploymentId: this.registry.deploymentId,
      instanceId: this.registry.instanceId,
      leaseMs: this.leaseMs,
      stale: false,
    };
  }

  claimAction(request) {
    const client = this.clients.get(request?.clientId);
    if (client === undefined || client.generation !== request?.generation) {
      throw routerError('client/stale-generation', 'the client generation is not current');
    }
    client.sessionId = typeof request.sessionId === 'string' ? request.sessionId : client.sessionId;
    client.focused = request.focused === true;
    client.lastSeen = this.now();
    const now = this.now();
    this.cleanup(now);
    const candidates = [...this.actions.values()].filter((action) =>
      action.status === 'pending' || (action.status === 'claimed' && action.leaseExpiresAt <= now));
    const matching = candidates.filter((action) => action.sessionId === client.sessionId);
    const action = (matching.length > 0 ? matching : candidates)
      .sort((left, right) => left.createdAt - right.createdAt)[0];
    if (action === undefined) return null;
    action.status = 'claimed';
    action.claimedBy = client.clientId;
    action.claimGeneration = client.generation;
    action.leaseExpiresAt = now + this.leaseMs;
    return {
      actionId: action.actionId,
      kind: action.kind,
      notificationId: action.notificationId,
      sessionId: action.sessionId,
      leaseExpiresAt: action.leaseExpiresAt,
      deploymentId: this.registry.deploymentId,
      instanceId: this.registry.instanceId,
    };
  }

  completeAction(request) {
    const client = this.clients.get(request?.clientId);
    if (client === undefined || client.generation !== request?.generation) {
      throw routerError('client/stale-generation', 'the client generation is not current');
    }
    const action = this.actions.get(request?.actionId);
    if (action === undefined) return { accepted: false, duplicate: false };
    if (action.claimedBy !== client.clientId || action.claimGeneration !== client.generation) {
      return { accepted: false, duplicate: false };
    }
    if (action.status === 'completed') return { accepted: true, duplicate: true };
    const status = request.status;
    if (!['opened', 'failed', 'unknown'].includes(status)) {
      throw routerError('action/invalid-status', 'invalid action result status');
    }
    action.status = 'completed';
    action.result = status;
    action.errorCode = typeof request.errorCode === 'string' ? request.errorCode : '';
    action.completedAt = this.now();
    // Keep the completed action until its notification expires so a repeated
    // callback can receive the same idempotent result.
    return { accepted: true, duplicate: false };
  }

  /** Host-side entry point used by the native helper after it validates a callback. */
  enqueue({ notificationId, kind }) {
    if (kind !== 'open') throw routerError('action/invalid-kind', 'only open actions are supported');
    if (this.registry === undefined) throw routerError('registry/unavailable', 'the notification registry is unavailable');
    const resolved = this.registry.resolve(notificationId);
    if (!resolved.ok) return { ok: false, code: resolved.code };
    const current = [...this.actions.values()].find((action) =>
      action.notificationId === notificationId && action.kind === kind);
    if (current !== undefined) {
      return {
        ok: true,
        action: {
          actionId: current.actionId,
          kind: current.kind,
          notificationId: current.notificationId,
          sessionId: current.sessionId,
          leaseExpiresAt: current.leaseExpiresAt,
          deploymentId: this.registry.deploymentId,
          instanceId: this.registry.instanceId,
        },
      };
    }
    const action = {
      actionId: this.newId(),
      kind,
      notificationId,
      sessionId: resolved.record.route.sessionId,
      status: 'pending',
      claimedBy: undefined,
      claimGeneration: undefined,
      leaseExpiresAt: 0,
      createdAt: this.now(),
      expiresAt: resolved.record.expiresAt,
      result: undefined,
      errorCode: undefined,
      completedAt: undefined,
    };
    this.actions.set(action.actionId, action);
    this.cleanup();
    return {
      ok: true,
      action: {
        actionId: action.actionId,
        kind: action.kind,
        notificationId: action.notificationId,
        sessionId: action.sessionId,
        leaseExpiresAt: action.leaseExpiresAt,
        deploymentId: this.registry.deploymentId,
        instanceId: this.registry.instanceId,
      },
    };
  }

  listClients() {
    return [...this.clients.values()].map(clientView);
  }

  listActions() {
    return [...this.actions.values()].map((action) => ({ ...action }));
  }

  dispose() {
    this.clients.clear();
    this.actions.clear();
  }
}
