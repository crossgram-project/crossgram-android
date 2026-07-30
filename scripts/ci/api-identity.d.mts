export const DEFAULT_API_ID: string;
export const DEFAULT_API_HASH: string;

export interface ApiIdentityEnvironment {
  readonly CROSSGRAM_TELEGRAM_API_ID?: string;
  readonly CROSSGRAM_TELEGRAM_API_HASH?: string;
}

export interface ApiIdentity {
  readonly apiId: string;
  readonly apiHash: string;
}

export function resolveApiIdentity(
  environment?: ApiIdentityEnvironment,
): ApiIdentity;

export function writeApiIdentity(
  client: string,
  root: string,
  identity?: ApiIdentity,
): Promise<string[]>;
