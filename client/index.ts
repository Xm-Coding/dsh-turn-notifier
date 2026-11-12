import TYPERT_REMOTE from '../lib/typert.remote-client.js';

interface RemoteResult<T> {
  ok: boolean;
  value?: T;
  error?: { code?: string };
}

interface TurnNotifierApi {
  registerClient(request: Record<string, unknown>, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
  claimAction(request: Record<string, unknown>, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
  completeAction(request: Record<string, unknown>, signal?: AbortSignal): Promise<RemoteResult<unknown>>;
}

interface ClientContext {
  effect(setup: () => Promise<() => void>): unknown;
  inject(services: string[], callback: (scope: ClientContext) => void): { dispose(): void };
  logger?: { warn(message: string): void };
  uiWorkspace?: { openSession(sessionId: string): void };
  uiSession?: {
    adapter?: { current?: { value?: { key?: string; props?: Record<string, unknown> } } };
  };
  remote: {
    $mount(contribution: typeof TYPERT_REMOTE): Promise<() => void>;
    turnNotifier: TurnNotifierApi;
  };
}

const POLL_INTERVAL_MS = 1_000;

function currentSessionId(ctx: ClientContext): string {
  try {
    const binding = ctx.uiSession?.adapter?.current?.value;
    const fromProps = binding?.props?.sessionId;
    if (typeof fromProps === 'string') return fromProps;
    return typeof binding?.key === 'string' ? binding.key : '';
  } catch (_error) {
    return '';
  }
}

function focused(): boolean {
  try {
    return document.visibilityState === 'visible' && document.hasFocus();
  } catch (_error) {
    return false;
  }
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function log(ctx: ClientContext, message: string): void {
  try {
    ctx.logger?.warn(`[dsh-turn-notifier] ${message}`);
  } catch (_error) {
    // Logging must never break the polling loop.
  }
}

export const inject = ['remote', 'uiWorkspace', 'uiSession'];

/**
 * Register this tab/window with the Host and claim notification actions. The
 * Remote namespace is mounted by this plugin, so it must be injected through
 * a child fiber after `$mount`; a static inject would wait for itself.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(async () => {
    const disposeMount = await ctx.remote.$mount(TYPERT_REMOTE);
    const controller = new AbortController();
    const clientId = crypto.randomUUID();
    let generation = 0;

    const start = async (api: TurnNotifierApi) => {
      const register = async () => {
        generation += 1;
        return api.registerClient({
          clientId,
          generation,
          sessionId: currentSessionId(ctx),
          focused: focused(),
          capabilities: ['open'],
        }, controller.signal);
      };

      try {
        const registration = await register();
        if (!registration.ok) log(ctx, 'client registration failed');
      } catch (_error) {
        log(ctx, 'client registration rejected');
      }

      while (!controller.signal.aborted) {
        await wait(POLL_INTERVAL_MS, controller.signal);
        if (controller.signal.aborted) return;
        try {
          const result = await api.claimAction({
            clientId,
            generation,
            sessionId: currentSessionId(ctx),
            focused: focused(),
          }, controller.signal);
          if (!result.ok || result.value === null || result.value === undefined) continue;
          const action = result.value;
          let status = 'failed';
          let errorCode = '';
          try {
            if (action.kind === 'open' && typeof action.sessionId === 'string' && ctx.uiWorkspace) {
              ctx.uiWorkspace.openSession(action.sessionId);
              status = 'opened';
            } else {
              errorCode = 'unsupported-action';
            }
          } catch (_error) {
            errorCode = 'navigation-failed';
          }
          await api.completeAction({
            clientId,
            generation,
            actionId: action.actionId,
            status,
            errorCode,
          }, controller.signal);
        } catch (_error) {
          log(ctx, 'action poll failed');
        }
      }
    };

    const follow = ctx.inject(['remote.turnNotifier'], (scope) => {
      void start(scope.remote.turnNotifier).catch(() => {
        log(ctx, 'action loop stopped');
      });
    });

    return () => {
      controller.abort();
      follow.dispose();
      disposeMount();
    };
  });
}
