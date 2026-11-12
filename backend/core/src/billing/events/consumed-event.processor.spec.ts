jest.mock('../../config', () => ({
  envs: {},
}));

jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
}));

import {
  ConsumedEventProcessor,
  PoisonEventError,
  type ConsumedEventHandler,
} from './consumed-event.processor';

describe('ConsumedEventProcessor', () => {
  let processor: ConsumedEventProcessor;
  let mockPrisma: any;
  let mockEvents: any;

  beforeEach(() => {
    mockPrisma = {
      $transaction: jest.fn(async (callback) => {
        const tx = {
          processedEvent: {
            createMany: jest.fn().mockResolvedValue({ count: 1 }),
          },
        };
        return callback(tx);
      }),
    };

    mockEvents = {
      registerHandler: jest.fn(),
    };

    processor = new ConsumedEventProcessor(mockPrisma, mockEvents);
  });

  const validTenant = '0199b7e0-0000-7000-8000-000000000001';
  const validEventId = '0199b7e0-0000-7000-8000-000000000002';
  const validMessage = {
    subject: `t.${validTenant}.auth.tenant_created`,
    tenantId: validTenant,
    payload: {
      eventId: validEventId,
      tenantId: validTenant,
      occurredAt: '2026-10-24T12:00:00.000Z',
      name: 'Acme',
    },
  };

  it('registers handler on events service', () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn(),
    };

    processor.register(handler);
    expect(mockEvents.registerHandler).toHaveBeenCalledWith(
      't.*.auth.tenant_created',
      expect.any(Function),
    );
  });

  it('discards malformed envelope without processing', async () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn(),
    };

    await processor.process(handler, {
      subject: `t.${validTenant}.auth.tenant_created`,
      tenantId: validTenant,
      payload: { eventId: 'not-a-uuid' },
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('discards message when subject tenant and payload tenant do not match', async () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn(),
    };

    await processor.process(handler, {
      subject: `t.${validTenant}.auth.tenant_created`,
      tenantId: validTenant,
      payload: {
        eventId: validEventId,
        tenantId: '0199b7e0-0000-7000-8000-999999999999',
        occurredAt: '2026-10-24T12:00:00.000Z',
      },
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('processes valid envelope and runs post-commit effects', async () => {
    const effect = jest.fn().mockResolvedValue(undefined);
    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn().mockResolvedValue([effect]),
    };

    await processor.process(handler, validMessage);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(handler.handle).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: validEventId,
        tenantId: validTenant,
        occurredAt: new Date('2026-10-24T12:00:00.000Z'),
      }),
    );
    expect(effect).toHaveBeenCalled();
  });

  it('deduplicates when eventId was already processed', async () => {
    mockPrisma.$transaction = jest.fn(async (callback) => {
      const tx = {
        processedEvent: {
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return callback(tx);
    });

    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn(),
    };

    await processor.process(handler, validMessage);

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
  });

  it('silently discards and catches PoisonEventError', async () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn().mockRejectedValue(new PoisonEventError('Corrupt body')),
    };

    await expect(
      processor.process(handler, validMessage),
    ).resolves.toBeUndefined();
  });

  it('rethrows unexpected transient error so it can be nacked', async () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.auth.tenant_created',
      handle: jest.fn().mockRejectedValue(new Error('DB connection lost')),
    };

    await expect(processor.process(handler, validMessage)).rejects.toThrow(
      'DB connection lost',
    );
  });
});
