export interface MtprotoEvent {
  id?: number;
  direction?: string;
  messageId?: string;
  requestMessageId?: string;
  payload?: unknown;
}

export interface MtprotoSnapshot {
  events?: MtprotoEvent[];
}

export function findRpcMethod(payload: unknown, method: string): Record<string, unknown> | undefined;
export function latestEventId(snapshot: MtprotoSnapshot): number;
export function findSendRequest(snapshot: MtprotoSnapshot, message: string): MtprotoEvent | undefined;
export function countSendRequests(snapshot: MtprotoSnapshot, message: string): number;
export function findRpcError(
  snapshot: MtprotoSnapshot,
  requestMessageId: string,
  errorCode: number,
  errorText?: string,
): MtprotoEvent | undefined;
