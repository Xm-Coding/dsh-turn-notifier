import type { Context } from '@deepseek-ai/cordis';
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type {
  ClaimActionRequest,
  ClaimedAction,
  CompleteActionRequest,
  CompleteActionResult,
  PingResult,
  RegisterClientRequest,
  RegisterClientResult,
} from './types.js';

interface ActionRouterLike {
  registerClient(request: RegisterClientRequest): RegisterClientResult;
  claimAction(request: ClaimActionRequest): ClaimedAction | null;
  completeAction(request: CompleteActionRequest): CompleteActionResult;
}

export interface TurnNotifierRuntime {
  readonly router: ActionRouterLike;
}

/**
 * Host service for notification actions. The service reads its runtime from
 * the Cordis plugin config so the registry and router stay owned by the
 * plugin fiber.
 */
export class TurnNotifierActions extends TypertRemoteService {
  private readonly runtime: TurnNotifierRuntime | undefined;

  constructor(ctx: Context, runtime?: TurnNotifierRuntime) {
    super(ctx, 'turnNotifierActions', { namespace: 'turnNotifier' });
    this.runtime = runtime;
  }

  /**
   * Prove that the generated Client contribution reaches this Host service.
   * @param signal - carrier cancellation.
   * @returns a fixed value; no notification data is involved.
   */
  @Remote('ping')
  ping(signal: AbortSignal): PingResult {
    signal.throwIfAborted();
    return { pong: true };
  }

  /**
   * Register one authenticated Client connection. The Host assigns the
   * deployment identity; the Client does not supply it.
   * @param request - Client generation, current session and capabilities.
   * @param signal - carrier cancellation.
   */
  @Remote('registerClient')
  registerClient(request: RegisterClientRequest, signal: AbortSignal): RegisterClientResult {
    signal.throwIfAborted();
    if (this.runtime === undefined) throw new Error('turn-notifier runtime is unavailable');
    return this.runtime.router.registerClient(request);
  }

  /**
   * Claim one pending action under a short Host lease.
   * @param request - Client generation and current session.
   * @param signal - carrier cancellation.
   */
  @Remote('claimAction')
  claimAction(request: ClaimActionRequest, signal: AbortSignal): ClaimedAction | null {
    signal.throwIfAborted();
    if (this.runtime === undefined) throw new Error('turn-notifier runtime is unavailable');
    return this.runtime.router.claimAction(request);
  }

  /**
   * Report the Client-side outcome of a claimed action.
   * @param request - client generation, action id and result.
   * @param signal - carrier cancellation.
   */
  @Remote('completeAction')
  completeAction(request: CompleteActionRequest, signal: AbortSignal): CompleteActionResult {
    signal.throwIfAborted();
    if (this.runtime === undefined) throw new Error('turn-notifier runtime is unavailable');
    return this.runtime.router.completeAction(request);
  }
}
