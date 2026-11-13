export const FCM_PROVIDER = Symbol('FCM_PROVIDER');

export interface FcmSendInput {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
}

export interface FcmSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  /** True when FCM reports an unregistered or permanently invalid token. */
  isUnregistered?: boolean;
}

export interface FcmProvider {
  send(input: FcmSendInput): Promise<FcmSendResult>;
}
