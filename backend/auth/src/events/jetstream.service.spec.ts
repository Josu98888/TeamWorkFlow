import { Logger } from '@nestjs/common';
import {
  JetStreamApiCodes,
  JetStreamApiError,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { AUTH_EVENTS, CONSUMED_SUBJECTS } from './auth.events';
import { JetStreamService } from './jetstream.service';

jest.mock('@nats-io/transport-node', () => ({ connect: jest.fn() }));
jest.mock('@nats-io/jetstream', () => ({
  ...jest.requireActual<object>('@nats-io/jetstream'),
  jetstream: jest.fn(),
  jetstreamManager: jest.fn(),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SEVEN_DAYS_NS = 604_800_000_000_000;

function apiError(errCode: number) {
  return new JetStreamApiError({
    code: 404,
    err_code: errCode,
    description: 'not found',
  });
}

interface FakeMessage {
  subject: string;
  json: jest.Mock;
  ack: jest.Mock;
  nak: jest.Mock;
  term: jest.Mock;
}

function fakeMessage(subject: string, payload: unknown): FakeMessage {
  return {
    subject,
    json: jest.fn(() => payload),
    ack: jest.fn(),
    nak: jest.fn(),
    term: jest.fn(),
  };
}

// Async iterable the test can push into; `close` ends it.
function fakeFeed() {
  const queue: FakeMessage[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  return {
    push(message: FakeMessage) {
      queue.push(message);
      wake?.();
    },
    close: jest.fn(() => {
      closed = true;
      wake?.();
      return Promise.resolve();
    }),
    async *[Symbol.asyncIterator]() {
      while (!closed) {
        const next = queue.shift();
        if (next) {
          yield next;
        } else {
          await new Promise<void>((resolve) => (wake = resolve));
        }
      }
    },
  };
}

async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

function setup() {
  const feeds = {
    'auth-billing': fakeFeed(),
    'auth-organization': fakeFeed(),
  };
  const jsm = {
    streams: { update: jest.fn().mockResolvedValue({}), add: jest.fn() },
    consumers: { update: jest.fn().mockResolvedValue({}), add: jest.fn() },
  };
  const js = {
    publish: jest.fn().mockResolvedValue({ seq: 1 }),
    consumers: {
      get: jest.fn((_stream: string, durable: keyof typeof feeds) =>
        Promise.resolve({ consume: () => Promise.resolve(feeds[durable]) }),
      ),
    },
  };
  const connection = { drain: jest.fn().mockResolvedValue(undefined) };
  jest.mocked(connect).mockResolvedValue(connection as never);
  jest.mocked(jetstream).mockReturnValue(js as never);
  jest.mocked(jetstreamManager).mockResolvedValue(jsm as never);

  const service = new JetStreamService({
    servers: ['nats://localhost:4222'],
    retryInitialMs: 1,
    retryMaxMs: 2,
  });
  return { service, feeds, jsm, js, connection };
}

describe('JetStreamService', () => {
  let service: JetStreamService;
  let feeds: ReturnType<typeof setup>['feeds'];
  let jsm: ReturnType<typeof setup>['jsm'];
  let js: ReturnType<typeof setup>['js'];
  let connection: ReturnType<typeof setup>['connection'];
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;

  beforeEach(() => {
    ({ service, feeds, jsm, js, connection } = setup());
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    jest.restoreAllMocks();
  });

  // Covers: S1.8
  describe('streams and consumers', () => {
    it('updates the AUTH_EVENTS stream when it exists', async () => {
      await service.onModuleInit();

      expect(jsm.streams.update).toHaveBeenCalledWith('AUTH_EVENTS', {
        subjects: ['t.*.auth.>'],
        max_age: SEVEN_DAYS_NS,
      });
      expect(jsm.streams.add).not.toHaveBeenCalled();
    });

    it('creates AUTH_EVENTS with file storage and limits retention', async () => {
      jsm.streams.update.mockRejectedValue(
        apiError(JetStreamApiCodes.StreamNotFound),
      );

      await service.onModuleInit();

      expect(jsm.streams.add).toHaveBeenCalledWith({
        name: 'AUTH_EVENTS',
        subjects: ['t.*.auth.>'],
        max_age: SEVEN_DAYS_NS,
        storage: 'file',
        retention: 'limits',
      });
    });

    it('creates the durables filtered to the consumed subjects with explicit ack', async () => {
      jsm.consumers.update.mockRejectedValue(
        apiError(JetStreamApiCodes.ConsumerNotFound),
      );

      await service.onModuleInit();
      await until(() => jsm.consumers.add.mock.calls.length === 2);

      const byStream = Object.fromEntries(
        jsm.consumers.add.mock.calls.map(([stream, config]) => [
          stream,
          config,
        ]),
      );
      expect(byStream['ORGANIZATION_EVENTS']).toEqual({
        durable_name: 'auth-organization',
        ack_policy: 'explicit',
        filter_subjects: ['t.*.organization.employee_created'],
      });
      expect(byStream['BILLING_EVENTS']).toMatchObject({
        durable_name: 'auth-billing',
        ack_policy: 'explicit',
      });
      expect(byStream['BILLING_EVENTS'].filter_subjects).toHaveLength(8);
      expect(
        byStream['BILLING_EVENTS'].filter_subjects.every((subject: string) =>
          subject.startsWith('t.*.billing.'),
        ),
      ).toBe(true);
    });

    it('retries with backoff while the producer stream does not exist', async () => {
      jsm.consumers.update
        .mockRejectedValueOnce(apiError(JetStreamApiCodes.StreamNotFound))
        .mockRejectedValueOnce(apiError(JetStreamApiCodes.StreamNotFound))
        .mockResolvedValue({});

      await expect(service.onModuleInit()).resolves.toBeUndefined();
      await until(() => js.consumers.get.mock.calls.length === 2);

      expect(warnLog).toHaveBeenCalled();
      expect(jsm.consumers.update.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('closes the consumers and the connection on destroy', async () => {
      await service.onModuleInit();
      await until(() => js.consumers.get.mock.calls.length === 2);

      await service.onModuleDestroy();

      expect(feeds['auth-billing'].close).toHaveBeenCalled();
      expect(feeds['auth-organization'].close).toHaveBeenCalled();
      expect(connection.drain).toHaveBeenCalled();
    });
  });

  // Covers: S1.8
  describe('publish', () => {
    beforeEach(async () => {
      await service.onModuleInit();
    });

    it('publishes t.<tenantId>.auth.<event> with eventId and occurredAt', async () => {
      await service.publish('tenant-1', AUTH_EVENTS.tenantReactivated, {
        tenantId: 'tenant-1',
      });

      expect(js.publish).toHaveBeenCalledTimes(1);
      const [subject, data, options] = js.publish.mock.calls[0] as [
        string,
        string,
        { msgID: string },
      ];
      const body = JSON.parse(data) as Record<string, string>;
      expect(subject).toBe('t.tenant-1.auth.tenant_reactivated');
      expect(body.tenantId).toBe('tenant-1');
      expect(body.eventId).toMatch(UUID);
      expect(body.occurredAt).toMatch(ISO_UTC);
      expect(options.msgID).toBe(body.eventId);
    });

    it('uses a different eventId for every event', async () => {
      await service.publish('t1', AUTH_EVENTS.tenantReactivated, {
        tenantId: 't1',
      });
      await service.publish('t1', AUTH_EVENTS.tenantReactivated, {
        tenantId: 't1',
      });

      const ids = js.publish.mock.calls.map(
        ([, data]) =>
          (JSON.parse(data as string) as { eventId: string }).eventId,
      );
      expect(new Set(ids).size).toBe(2);
    });

    it('logs a failed publish without the payload, does not retry and does not throw', async () => {
      js.publish.mockRejectedValue(new Error('no stream matches subject'));

      await expect(
        service.publish('tenant-1', AUTH_EVENTS.userCreated, {
          userId: 'u1',
          tenantId: 'tenant-1',
          email: 'secret@example.com',
          name: 'Secret Name',
          role: 'owner',
        }),
      ).resolves.toBeUndefined();

      expect(js.publish).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = String(errorLog.mock.calls[0][0]);
      expect(logged).toContain('user_created');
      expect(logged).not.toContain('secret@example.com');
      expect(logged).not.toContain('Secret Name');
    });

    it('logs and does not throw for an invalid tenant id', async () => {
      await expect(
        service.publish('a.b', AUTH_EVENTS.tenantReactivated, {
          tenantId: 'a.b',
        }),
      ).resolves.toBeUndefined();

      expect(js.publish).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });
  });

  // Covers: S1.8
  describe('consume', () => {
    const subject = 't.tenant-1.billing.payment_overdue';

    beforeEach(async () => {
      await service.onModuleInit();
      await until(() => js.consumers.get.mock.calls.length === 2);
    });

    it('acks only after the handler succeeds', async () => {
      const order: string[] = [];
      const message = fakeMessage(subject, { tenantId: 'tenant-1' });
      message.ack.mockImplementation(() => order.push('ack'));
      service.registerHandler(CONSUMED_SUBJECTS.paymentOverdue, () => {
        order.push('handler');
        return Promise.resolve();
      });

      feeds['auth-billing'].push(message);
      await until(() => message.ack.mock.calls.length === 1);

      expect(order).toEqual(['handler', 'ack']);
      expect(message.nak).not.toHaveBeenCalled();
    });

    it('passes the tenant of the subject and the parsed payload', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      const message = fakeMessage(subject, { tenantId: 'tenant-1' });
      service.registerHandler(CONSUMED_SUBJECTS.paymentOverdue, handler);

      feeds['auth-billing'].push(message);
      await until(() => handler.mock.calls.length === 1);

      expect(handler).toHaveBeenCalledWith({
        subject,
        tenantId: 'tenant-1',
        payload: { tenantId: 'tenant-1' },
      });
    });

    it('does not ack when the handler throws and logs without the payload', async () => {
      const message = fakeMessage(subject, { email: 'secret@example.com' });
      service.registerHandler(CONSUMED_SUBJECTS.paymentOverdue, () =>
        Promise.reject(new Error('failed for secret@example.com')),
      );

      feeds['auth-billing'].push(message);
      await until(() => message.nak.mock.calls.length === 1);

      expect(message.ack).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
      const logged = String(errorLog.mock.calls[0][0]);
      expect(logged).toContain(subject);
      expect(logged).not.toContain('secret@example.com');
    });

    it('does not ack a message without a registered handler', async () => {
      const message = fakeMessage(subject, {});

      feeds['auth-billing'].push(message);
      await until(() => message.nak.mock.calls.length === 1);

      expect(message.ack).not.toHaveBeenCalled();
    });

    it('terminates a message whose payload is not valid JSON', async () => {
      const handler = jest.fn();
      const message = fakeMessage(subject, {});
      message.json.mockImplementation(() => {
        throw new SyntaxError('Unexpected token');
      });
      service.registerHandler(CONSUMED_SUBJECTS.paymentOverdue, handler);

      feeds['auth-billing'].push(message);
      await until(() => message.term.mock.calls.length === 1);

      expect(handler).not.toHaveBeenCalled();
      expect(message.ack).not.toHaveBeenCalled();
    });
  });
});
