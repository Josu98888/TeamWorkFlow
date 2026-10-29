import { Test, TestingModule } from '@nestjs/testing';
import {
  ConsumedEventProcessor,
  PoisonEventError,
  type ConsumedEventHandler,
} from './consumed-event.processor';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService } from '../nats/jetstream.service';

describe('ConsumedEventProcessor', () => {
  let processor: ConsumedEventProcessor;

  const mockTx = {
    processedEvent: {
      createMany: jest.fn(),
    },
  };

  const mockPrisma = {
    $transaction: jest.fn((cb: any) => cb(mockTx)),
  };

  const mockJetStream = {
    registerHandler: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ConsumedEventProcessor,
        { provide: AttendancePrismaService, useValue: mockPrisma },
        { provide: JetStreamService, useValue: mockJetStream },
      ],
    }).compile();

    processor = module.get<ConsumedEventProcessor>(ConsumedEventProcessor);
  });

  it('registers handler on JetStreamService', () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle: jest.fn(),
    };

    processor.register(handler);

    expect(mockJetStream.registerHandler).toHaveBeenCalledWith(
      't.*.org.test',
      expect.any(Function),
    );
  });

  it('discards malformed events without calling handler or DB', async () => {
    const handle = jest.fn();
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle,
    };

    // missing eventId
    await processor.process(handler, {
      subject: 't.tenant-1.org.test',
      tenantId: 'tenant-1',
      payload: { tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' },
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('discards events with tenant mismatch between subject and payload', async () => {
    const handle = jest.fn();
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle,
    };

    await processor.process(handler, {
      subject: 't.a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11.org.test',
      tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      payload: {
        eventId: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        tenantId: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', // mismatch
        occurredAt: new Date().toISOString(),
      },
    });

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });

  it('skips duplicate events if already processed (createMany count = 0)', async () => {
    const handle = jest.fn();
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle,
    };
    mockTx.processedEvent.createMany.mockResolvedValueOnce({ count: 0 });

    const tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const eventId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    await processor.process(handler, {
      subject: `t.${tenantId}.org.test`,
      tenantId,
      payload: {
        eventId,
        tenantId,
        occurredAt: new Date().toISOString(),
      },
    });

    expect(mockTx.processedEvent.createMany).toHaveBeenCalledWith({
      data: [
        {
          eventId,
          tenantId,
          eventType: `t.${tenantId}.org.test`,
        },
      ],
      skipDuplicates: true,
    });
    expect(handle).not.toHaveBeenCalled();
  });

  it('processes new event, executes handler, and runs post-commit effects', async () => {
    const postEffect = jest.fn().mockResolvedValue(undefined);
    const handle = jest.fn().mockResolvedValueOnce([postEffect]);
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle,
    };
    mockTx.processedEvent.createMany.mockResolvedValueOnce({ count: 1 });

    const tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const eventId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    await processor.process(handler, {
      subject: `t.${tenantId}.org.test`,
      tenantId,
      payload: {
        eventId,
        tenantId,
        occurredAt: new Date().toISOString(),
      },
    });

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        eventId,
        tx: mockTx,
      }),
    );
    expect(postEffect).toHaveBeenCalled();
  });

  it('discards PoisonEventError without rethrowing', async () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle: jest.fn().mockRejectedValueOnce(new PoisonEventError('Corrupt payload')),
    };
    mockTx.processedEvent.createMany.mockResolvedValueOnce({ count: 1 });

    const tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const eventId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    await expect(
      processor.process(handler, {
        subject: `t.${tenantId}.org.test`,
        tenantId,
        payload: {
          eventId,
          tenantId,
          occurredAt: new Date().toISOString(),
        },
      }),
    ).resolves.not.toThrow();
  });

  it('rethrows unexpected transient errors for JetStream retry', async () => {
    const handler: ConsumedEventHandler = {
      filter: 't.*.org.test',
      handle: jest.fn().mockRejectedValueOnce(new Error('DB deadlock')),
    };
    mockTx.processedEvent.createMany.mockResolvedValueOnce({ count: 1 });

    const tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
    const eventId = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

    await expect(
      processor.process(handler, {
        subject: `t.${tenantId}.org.test`,
        tenantId,
        payload: {
          eventId,
          tenantId,
          occurredAt: new Date().toISOString(),
        },
      }),
    ).rejects.toThrow('DB deadlock');
  });
});
