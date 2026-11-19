import { Injectable } from '@nestjs/common';
import type {
  FcmProvider,
  FcmSendInput,
  FcmSendResult,
} from './fcm-provider.interface';

export interface RecordedPushMessage {
  token: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  messageId: string;
}

/**
 * In-memory FCM provider used when FCM_ENABLED=false (dev and E2E tests).
 * Callers can pre-register tokens via `simulateUnregistered` or `simulateFailure`
 * to exercise error and token deactivation branches deterministically.
 */
@Injectable()
export class FakeFcmProviderService implements FcmProvider {
  private readonly sent: RecordedPushMessage[] = [];
  private readonly unregisteredTokens = new Set<string>();
  private readonly failingTokens = new Map<string, string>();
  private sequence = 0;

  async send(input: FcmSendInput): Promise<FcmSendResult> {
    if (this.unregisteredTokens.has(input.token)) {
      return {
        success: false,
        error: 'messaging/registration-token-not-registered',
        isUnregistered: true,
      };
    }

    const transientError = this.failingTokens.get(input.token);
    if (transientError) {
      return {
        success: false,
        error: transientError,
        isUnregistered: false,
      };
    }

    this.sequence += 1;
    const messageId = `fake-fcm-${this.sequence}`;
    this.sent.push({
      token: input.token,
      title: input.title,
      body: input.body,
      data: input.data,
      messageId,
    });

    return {
      success: true,
      messageId,
    };
  }

  getSentMessages(): readonly RecordedPushMessage[] {
    return this.sent;
  }

  clear(): void {
    this.sent.length = 0;
    this.unregisteredTokens.clear();
    this.failingTokens.clear();
    this.sequence = 0;
  }

  simulateUnregistered(token: string): void {
    this.unregisteredTokens.add(token);
  }

  simulateFailure(token: string, errorCode = 'messaging/unavailable'): void {
    this.failingTokens.set(token, errorCode);
  }
}
