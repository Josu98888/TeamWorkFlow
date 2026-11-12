import {
  JetStreamApiCodes,
  JetStreamApiError,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import { BILLING_STREAM } from '../billing.patterns';
import { BILLING_EVENTS } from './billing.events';
import {
  BillingEventsService,
  MAX_DELIVERIES,
  handlerRetryDelayMs,
} from './billing-events.service';

jest.mock('@nats-io/transport-node', () => ({ connect: jest.fn() }));
jest.mock('@nats-io/jetstream', () => ({
  ...jest.requireActual<object>('@nats-io/jetstream'),
  jetstream: jest.fn(),
  jetstreamManager: jest.fn(),
}));

function apiError(errCode: number) {
  return new JetStreamApiError({
    code: 404,
    err_code: errCode,
    description: 'not found',
  });
}

describe('BillingEventsService', () => {
  let service: BillingEventsService;
  let mockJs: { publish: jest.Mock; consumers: { get: jest.Mock } };
  let mockJsm: {
    streams: { update: jest.Mock; add: jest.Mock };
    consumers: { update: jest.Mock; add: jest.Mock };
  };

  beforeEach(() => {
    mockJs = {
      publish: jest.fn().mockResolvedValue({ seq: 1 }),
      consumers: {
        get: jest.fn().mockResolvedValue({
          consume: jest.fn().mockResolvedValue({
            [Symbol.asyncIterator]: async function* () {},
            close: jest.fn(),
          }),
        }),
      },
    };
    mockJsm = {
      streams: { update: jest.fn().mockResolvedValue({}), add: jest.fn() },
      consumers: { update: jest.fn().mockResolvedValue({}), add: jest.fn() },
    };

    (connect as jest.Mock).mockResolvedValue({
      drain: jest.fn().mockResolvedValue(undefined),
    });
    (jetstream as jest.Mock).mockReturnValue(mockJs);
    (jetstreamManager as jest.Mock).mockResolvedValue(mockJsm);

    service = new BillingEventsService({
      servers: ['nats://localhost:4222'],
      retryInitialMs: 10,
      retryMaxMs: 50,
    });
  });

  afterEach(async () => {
    await service.onModuleDestroy();
  });

  it('creates stream if it does not exist', async () => {
    mockJsm.streams.update.mockRejectedValueOnce(
      apiError(JetStreamApiCodes.StreamNotFound),
    );

    await service.onModuleInit();

    expect(mockJsm.streams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: BILLING_STREAM,
      }),
    );
  });

  it('publishes billing domain events with eventId and occurredAt', async () => {
    await service.onModuleInit();

    const tenantId = '0199b7e0-0000-7000-8000-000000000001';
    await service.publish(tenantId, BILLING_EVENTS.subscriptionCreated, {
      plan: 'pro',
    });

    expect(mockJs.publish).toHaveBeenCalledWith(
      `t.${tenantId}.billing.subscription_created`,
      expect.stringContaining('"plan":"pro"'),
      expect.objectContaining({ msgID: expect.any(String) }),
    );
  });

  it('publishes notification events to t.<tenant>.notifications.send', async () => {
    await service.onModuleInit();

    const tenantId = '0199b7e0-0000-7000-8000-000000000001';
    await service.publishNotification(tenantId, {
      recipientUserIds: ['user-1'],
      templateCode: 'billing_invoice_issued',
    });

    expect(mockJs.publish).toHaveBeenCalledWith(
      `t.${tenantId}.notifications.send`,
      expect.stringContaining('"templateCode":"billing_invoice_issued"'),
      expect.objectContaining({ msgID: expect.any(String) }),
    );
  });

  it('calculates exponential backoff delay correctly', () => {
    expect(handlerRetryDelayMs(1)).toBe(5000);
    expect(handlerRetryDelayMs(2)).toBe(10000);
    expect(handlerRetryDelayMs(3)).toBe(20000);
    expect(MAX_DELIVERIES).toBe(20);
  });
});
