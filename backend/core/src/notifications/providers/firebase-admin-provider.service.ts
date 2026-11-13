import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import type { App, ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import type { Messaging } from 'firebase-admin/messaging';
import { envs } from '../../config';
import type {
  FcmProvider,
  FcmSendInput,
  FcmSendResult,
} from './fcm-provider.interface';

export const FCM_OPTIONS = Symbol('FCM_OPTIONS');

export interface FirebaseAdminOptions {
  projectId?: string;
  credentials?: string;
}

const FIREBASE_APP_NAME = 'notifications-fcm';

const UNREGISTERED_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

function parseServiceAccount(raw: string): ServiceAccount {
  const trimmed = raw.trim();
  const decoded = trimmed.startsWith('{')
    ? trimmed
    : Buffer.from(trimmed, 'base64').toString('utf8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new Error('Invalid FCM_CREDENTIALS format');
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { client_email?: unknown }).client_email !== 'string' ||
    typeof (parsed as { private_key?: unknown }).private_key !== 'string'
  ) {
    throw new Error('FCM_CREDENTIALS missing required service account fields');
  }

  return parsed as ServiceAccount;
}

function extractFirebaseErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function isUnregisteredError(code: string | undefined, error: unknown): boolean {
  if (code && UNREGISTERED_ERROR_CODES.has(code)) {
    return true;
  }
  if (code === 'messaging/invalid-argument' && error instanceof Error) {
    return /registration token/i.test(error.message);
  }
  return false;
}

@Injectable()
export class FirebaseAdminProviderService implements FcmProvider {
  private readonly logger = new Logger(FirebaseAdminProviderService.name);
  private messagingClient?: Messaging;

  constructor(
    @Optional()
    @Inject(FCM_OPTIONS)
    private readonly options?: FirebaseAdminOptions,
  ) {}

  async send(input: FcmSendInput): Promise<FcmSendResult> {
    const messaging = this.getOrInitMessaging();
    try {
      const messageId = await messaging.send({
        token: input.token,
        notification: {
          title: input.title,
          body: input.body,
        },
        data: input.data,
      });
      return { success: true, messageId };
    } catch (error) {
      const code = extractFirebaseErrorCode(error);
      const unregistered = isUnregisteredError(code, error);
      const safeError = code ?? 'messaging/send-failed';
      this.logger.warn(`FCM send failed with code ${safeError}`);
      return {
        success: false,
        error: safeError,
        isUnregistered: unregistered,
      };
    }
  }

  private getOrInitMessaging(): Messaging {
    if (this.messagingClient) {
      return this.messagingClient;
    }

    const credentialsRaw = this.options?.credentials ?? envs.fcmCredentials;
    const projectId = this.options?.projectId ?? envs.fcmProjectId;
    if (!credentialsRaw) {
      throw new Error('FCM_CREDENTIALS is required when FCM is enabled');
    }

    let app: App | undefined = getApps().find(
      (existing) => existing.name === FIREBASE_APP_NAME,
    );
    if (!app) {
      const serviceAccount = parseServiceAccount(credentialsRaw);
      app = initializeApp(
        {
          credential: cert(serviceAccount),
          ...(projectId ? { projectId } : {}),
        },
        FIREBASE_APP_NAME,
      );
    }

    this.messagingClient = getMessaging(app);
    return this.messagingClient;
  }
}
