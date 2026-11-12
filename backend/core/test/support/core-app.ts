import { INestApplication } from '@nestjs/common';
import {
  ClientProxyFactory,
  MicroserviceOptions,
  Transport,
} from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { firstValueFrom } from 'rxjs';
import request from 'supertest';
import { configureApp } from '../../src/app.config';
import { AppModule } from '../../src/app.module';
import type { TokenPair } from '../../src/auth/token.service';

import { assertTestTargets } from './test-env';

export interface CoreE2eApp {
  app: INestApplication;
  // supertest agent bound to the HTTP server of the app.
  http: () => ReturnType<typeof request>;
  // NATS request-reply to the `queue: core` responders, like `telemetry`:
  // resolves with the reply and rejects with the `{ status, code, message }`
  // error object.
  send: <T = unknown>(pattern: string, data: unknown) => Promise<T>;
  close: () => Promise<void>;
}

// Boots the real `AppModule` the way `main.ts` does (HTTP app config plus the
// NATS microservice on the test broker) and a NATS client to talk to it.
// Requires the test stack and `applyTestEnv()` (done by the jest setup files).
export async function startCoreApp(): Promise<CoreE2eApp> {
  assertTestTargets();
  const servers = process.env.NATS_SERVER!.split(',');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  // JetStreamService retries (and logs) while the billing/organization streams
  // do not exist; keep the output readable.
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app);
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.NATS,
    options: { servers, queue: 'core' },
  });
  await app.startAllMicroservices();
  await app.init();

  const client = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers },
  });
  await client.connect();

  return {
    app,
    http: () => request(app.getHttpServer()),
    send: <T>(pattern: string, data: unknown) =>
      firstValueFrom(client.send<T, unknown>(pattern, data)),
    close: async () => {
      await client.close();
      await app.close();
    },
  };
}

// Auth header for guarded routes.
export const bearer = (tokens: Pick<TokenPair, 'accessToken'>) =>
  `Bearer ${tokens.accessToken}`;
