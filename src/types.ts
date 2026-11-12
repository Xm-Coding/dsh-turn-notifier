/** Result of the A0 Remote smoke endpoint. */
export interface PingResult {
  readonly pong: true;
}

/** A Client registering its current UI context with this Host deployment. */
export interface RegisterClientRequest {
  readonly clientId: string;
  readonly generation: number;
  readonly sessionId: string;
  readonly focused: boolean;
  readonly capabilities: string[];
}

export interface RegisterClientResult {
  readonly deploymentId: string;
  readonly instanceId: string;
  readonly leaseMs: number;
  readonly stale: boolean;
}

export interface ClaimActionRequest {
  readonly clientId: string;
  readonly generation: number;
  readonly sessionId: string;
  readonly focused: boolean;
}

export interface ClaimedAction {
  readonly actionId: string;
  readonly kind: string;
  readonly notificationId: string;
  readonly sessionId: string;
  readonly leaseExpiresAt: number;
  readonly deploymentId: string;
  readonly instanceId: string;
}

export interface CompleteActionRequest {
  readonly clientId: string;
  readonly generation: number;
  readonly actionId: string;
  readonly status: string;
  readonly errorCode: string;
}

export interface CompleteActionResult {
  readonly accepted: boolean;
  readonly duplicate: boolean;
}
