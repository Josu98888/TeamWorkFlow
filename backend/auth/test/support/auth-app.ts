import { INestMicroservice } from '@nestjs/common';
import { ClientProxyFactory, Transport } from '@nestjs/microservices';
import { Test } from '@nestjs/testing';
import { firstValueFrom } from 'rxjs';
import { AppModule } from '../../src/app.module';
import { createValidationPipe } from '../../src/common/pipes/validation.pipe';
import { assertTestTargets } from './test-env';

export interface AuthE2eApp {
  app: INestMicroservice;
  // Request-reply over NATS, like the gateway: resolves with the reply and
  // rejects with the `{ status, code, message }` error object.
  send: <T = unknown>(pattern: string, data: unknown) => Promise<T>;
  close: () => Promise<void>;
}

// Boots the real auth microservice (NATS transport on the test broker) and a
// NATS client to talk to it. Requires the test stack and `applyTestEnv()`
// (done by the jest setup files).
export async function startAuthApp(): Promise<AuthE2eApp> {
  assertTestTargets();
  const servers = process.env.NATS_SERVER!.split(',');

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestMicroservice({
    transport: Transport.NATS,
    options: { servers },
    // JetStreamService warns every second while billing/organization streams
    // do not exist; keep the output readable.
    logger: ['error'],
  });
  app.useGlobalPipes(createValidationPipe());
  await app.listen();

  const client = ClientProxyFactory.create({
    transport: Transport.NATS,
    options: { servers },
  });
  await client.connect();

  return {
    app,
    send: <T>(pattern: string, data: unknown) =>
      firstValueFrom(client.send<T, unknown>(pattern, data)),
    close: async () => {
      await client.close();
      await app.close();
    },
  };
}
