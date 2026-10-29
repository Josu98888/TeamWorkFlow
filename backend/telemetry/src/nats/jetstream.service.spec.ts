import {
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import {
  JetStreamService,
  MAX_DELIVERIES,
  handlerRetryDelayMs,
} from './jetstream.service';
import { CONSUMED_SUBJECTS } from '../consumers/consumers.constants';

jest.mock('@nats-io/transport-node', () => ({ connect: jest.fn() }));
jest.mock('@nats-io/jetstream', () => ({
  ...jest.requireActual<object>('@nats-io/jetstream'),
  jetstream: jest.fn(),
  jetstreamManager: jest.fn(),
}));

interface FakeMessage {
  subject: string;
  json: jest.Mock;
  ack: jest.Mock;
  nak: jest.Mock;
  term: jest.Mock;
  info: { deliveryCount: number };
}

function fakeMessage(subject: string, payload: unknown, deliveryCount = 1): FakeMessage {
  return {
    subject,
    info: { deliveryCount },
    json: jest.fn(() => payload),
    ack: jest.fn(),
    nak: jest.fn(),
    term: jest.fn(),
  };
}

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
    'telemetry-organization': fakeFeed(),
    'telemetry-auth': fakeFeed(),
    'telemetry-billing': fakeFeed(),
  };
  const jsm = {
    streams: {
      info: jest.fn().mockResolvedValue({}),
      add: jest.fn().mockResolvedValue({}),
    },
    consumers: {
      update: jest.fn().mockResolvedValue({}),
      add: jest.fn().mockResolvedValue({}),
    },
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

  const service = new JetStreamService();
  return { service, feeds, jsm, js, connection };
}

describe('JetStreamService', () => {
  let ctx: ReturnType<typeof setup>;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = setup();
  });

  afterEach(async () => {
    await ctx.service.onModuleDestroy();
  });

  it('initializes stream and connects', async () => {
    ctx.jsm.streams.info.mockRejectedValueOnce(new Error('Stream not found'));
    await ctx.service.onModuleInit();

    expect(ctx.jsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ATTENDANCE_EVENTS',
        subjects: ['t.*.attendance.>'],
      }),
    );
  });

  it('publishes event with auto-generated eventId and occurredAt', async () => {
    await ctx.service.onModuleInit();
    await ctx.service.publish('tenant-1', 'clock_event_recorded', {
      siteId: 'site-1',
    });

    expect(ctx.js.publish).toHaveBeenCalledWith(
      't.tenant-1.attendance.clock_event_recorded',
      expect.any(String),
      expect.objectContaining({ msgID: expect.any(String) }),
    );
  });

  it('starts durable consumers and dispatches messages to registered handlers', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    ctx.service.registerHandler(CONSUMED_SUBJECTS.SHIFT_CREATED, handler);

    await ctx.service.onModuleInit();
    await until(() => ctx.js.consumers.get.mock.calls.length === 3);

    const msg = fakeMessage('t.tenant-1.organization.shift_created', {
      shiftId: 'shift-1',
    });
    ctx.feeds['telemetry-organization'].push(msg);

    await until(() => handler.mock.calls.length === 1);
    expect(handler).toHaveBeenCalledWith({
      subject: 't.tenant-1.organization.shift_created',
      tenantId: 'tenant-1',
      payload: { shiftId: 'shift-1' },
    });
    expect(msg.ack).toHaveBeenCalled();
  });

  it('naks if no handler is registered for a message', async () => {
    await ctx.service.onModuleInit();
    await until(() => ctx.js.consumers.get.mock.calls.length === 3);

    const msg = fakeMessage('t.tenant-1.organization.shift_created', {});
    ctx.feeds['telemetry-organization'].push(msg);

    await until(() => msg.nak.mock.calls.length === 1);
    expect(msg.nak).toHaveBeenCalledWith(30000);
  });

  it('terms if payload is not valid JSON', async () => {
    ctx.service.registerHandler(CONSUMED_SUBJECTS.SHIFT_CREATED, jest.fn());
    await ctx.service.onModuleInit();
    await until(() => ctx.js.consumers.get.mock.calls.length === 3);

    const msg = fakeMessage('t.tenant-1.organization.shift_created', {});
    msg.json.mockImplementationOnce(() => {
      throw new Error('Malformed json');
    });
    ctx.feeds['telemetry-organization'].push(msg);

    await until(() => msg.term.mock.calls.length === 1);
    expect(msg.term).toHaveBeenCalledWith('invalid payload');
  });

  it('terms message when max deliveries is reached', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('DB failure'));
    ctx.service.registerHandler(CONSUMED_SUBJECTS.SHIFT_CREATED, handler);

    await ctx.service.onModuleInit();
    await until(() => ctx.js.consumers.get.mock.calls.length === 3);

    const msg = fakeMessage(
      't.tenant-1.organization.shift_created',
      {},
      MAX_DELIVERIES,
    );
    ctx.feeds['telemetry-organization'].push(msg);

    await until(() => msg.term.mock.calls.length === 1);
    expect(msg.term).toHaveBeenCalledWith('max deliveries reached');
  });

  it('calculates handler retry delay correctly', () => {
    expect(handlerRetryDelayMs(1)).toBe(5000);
    expect(handlerRetryDelayMs(2)).toBe(10000);
    expect(handlerRetryDelayMs(3)).toBe(20000);
    expect(handlerRetryDelayMs(10)).toBe(300000); // capped at 5 minutes
  });
});
