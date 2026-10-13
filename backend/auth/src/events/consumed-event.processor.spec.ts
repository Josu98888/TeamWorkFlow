import { Logger } from '@nestjs/common';
import { CONSUMED_SUBJECTS } from './auth.events';
import { ConsumedEventProcessor } from './consumed-event.processor';
import type {
  ConsumedEventContext,
  ConsumedEventHandler,
} from './consumed-event.processor';
import type { ConsumedMessage } from './jetstream.service';

jest.mock('../config', () => ({ envs: {} }));
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const EVENT_ID = '0199b7e0-0000-7000-8000-0000000000e1';
const OCCURRED_AT = '2026-10-13T10:00:00.000Z';

function message(overrides: Partial<ConsumedMessage> = {}): ConsumedMessage {
  return {
    subject: `t.${TENANT_A}.billing.payment_overdue`,
    tenantId: TENANT_A,
    payload: { eventId: EVENT_ID, tenantId: TENANT_A, occurredAt: OCCURRED_AT },
    ...overrides,
  };
}

// Covers: S7.1
describe('ConsumedEventProcessor', () => {
  let processed: Set<string>;
  let committed: boolean;
  let handle: jest.Mock<
    Promise<(() => Promise<void>)[]>,
    [ConsumedEventContext]
  >;
  let handler: ConsumedEventHandler;
  let processor: ConsumedEventProcessor;
  let errorLog: jest.SpyInstance;
  const registerHandler = jest.fn();
  const prisma = {
    processedEvent: { createMany: jest.fn() },
    $transaction: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    processed = new Set();
    committed = false;

    prisma.processedEvent.createMany.mockImplementation(
      ({ data }: { data: { eventId: string }[] }) => {
        const fresh = data.filter((row) => !processed.has(row.eventId));
        fresh.forEach((row) => processed.add(row.eventId));
        return Promise.resolve({ count: fresh.length });
      },
    );
    // Rolls the in-memory ProcessedEvent rows back when the callback throws.
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => {
        const snapshot = new Set(processed);
        try {
          const result = await callback(prisma);
          committed = true;
          return result;
        } catch (error) {
          processed = snapshot;
          throw error;
        }
      },
    );

    handle = jest.fn().mockResolvedValue([]);
    handler = { filter: CONSUMED_SUBJECTS.paymentOverdue, handle };
    processor = new ConsumedEventProcessor(
      prisma as never,
      { registerHandler } as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers the handler for its subject filter', async () => {
    processor.register(handler);

    expect(registerHandler).toHaveBeenCalledWith(
      CONSUMED_SUBJECTS.paymentOverdue,
      expect.any(Function),
    );
    const run = registerHandler.mock.calls[0][1] as (
      m: ConsumedMessage,
    ) => Promise<void>;
    await run(message());
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('records the eventId and runs the handler in the same transaction', async () => {
    await processor.process(handler, message());

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.processedEvent.createMany).toHaveBeenCalledWith({
      data: [{ eventId: EVENT_ID, tenantId: TENANT_A }],
      skipDuplicates: true,
    });
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_A,
        eventId: EVENT_ID,
        occurredAt: new Date(OCCURRED_AT),
        tx: prisma,
      }),
    );
  });

  it('a duplicate eventId is a no-op: the handler does not run and it resolves (ack)', async () => {
    await processor.process(handler, message());
    await expect(
      processor.process(handler, message()),
    ).resolves.toBeUndefined();

    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('runs the effects only after the commit', async () => {
    const effect = jest.fn(() => {
      expect(committed).toBe(true);
      return Promise.resolve();
    });
    handle.mockResolvedValue([effect]);

    await processor.process(handler, message());

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('does not run the effects of a duplicate', async () => {
    const effect = jest.fn(() => Promise.resolve());
    handle.mockResolvedValue([effect]);

    await processor.process(handler, message());
    await processor.process(handler, message());

    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('rejects (nak, redelivery) when the handler throws, and the eventId is not recorded', async () => {
    handle.mockRejectedValueOnce(new Error('db down'));
    const effect = jest.fn(() => Promise.resolve());

    await expect(processor.process(handler, message())).rejects.toThrow(
      'db down',
    );
    expect(processed.size).toBe(0);
    expect(effect).not.toHaveBeenCalled();

    // The redelivery is processed normally.
    handle.mockResolvedValueOnce([effect]);
    await processor.process(handler, message());
    expect(effect).toHaveBeenCalledTimes(1);
  });

  it('a failing effect is logged without payload and does not reject (the data is committed)', async () => {
    handle.mockResolvedValue([
      () => Promise.reject(new Error('secret@example.com')),
    ]);

    await expect(
      processor.process(handler, message()),
    ).resolves.toBeUndefined();

    expect(errorLog).toHaveBeenCalledTimes(1);
    expect(String(errorLog.mock.calls[0][0])).not.toContain('secret');
  });

  describe('poison messages are discarded: no transaction, acked, logged without payload', () => {
    it.each([
      ['a payload that is not an object', 'text'],
      ['an array payload', []],
      ['a missing eventId', { tenantId: TENANT_A, occurredAt: OCCURRED_AT }],
      [
        'an eventId that is not a uuid',
        { eventId: 'billing:1', tenantId: TENANT_A, occurredAt: OCCURRED_AT },
      ],
      ['a missing tenantId', { eventId: EVENT_ID, occurredAt: OCCURRED_AT }],
      [
        'an invalid occurredAt',
        { eventId: EVENT_ID, tenantId: TENANT_A, occurredAt: 'yesterday' },
      ],
      ['a missing occurredAt', { eventId: EVENT_ID, tenantId: TENANT_A }],
    ])('%s', async (_name, payload) => {
      await expect(
        processor.process(handler, message({ payload })),
      ).resolves.toBeUndefined();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();
      expect(errorLog).toHaveBeenCalledTimes(1);
    });

    it('a subject tenant different from the payload tenant (Covers: S7.5)', async () => {
      const subject = `t.${TENANT_B}.billing.payment_overdue`;

      await expect(
        processor.process(handler, message({ subject, tenantId: TENANT_B })),
      ).resolves.toBeUndefined();

      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();
      expect(processed.size).toBe(0);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(String(errorLog.mock.calls[0][0])).not.toContain(EVENT_ID);
    });

    it('a subject without a tenant', async () => {
      await processor.process(handler, message({ tenantId: null }));

      expect(handle).not.toHaveBeenCalled();
    });
  });
});
