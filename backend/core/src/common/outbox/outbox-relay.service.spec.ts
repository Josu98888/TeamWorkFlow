import {
  InMemoryOutboxStore,
  OutboxRelay,
  PrismaOutboxStore,
  type PrismaOutboxDelegate,
} from './outbox-relay.service';
import { OUTBOX_MAX_ATTEMPTS, outboxBackoffMs } from './outbox.types';

describe('OutboxRelay & Transactional Outbox Stores', () => {
  const tenantId = '0199b7e0-0000-7000-8000-000000000001';
  const eventId = '0199b7e0-0000-7000-8000-000000000010';
  const subject = `t.${tenantId}.organization.shift_created`;
  const payload = JSON.stringify({
    eventId,
    tenantId,
    shiftId: 'shift-1',
    occurredAt: '2026-11-04T12:00:00.000Z',
  });
  const baseTime = new Date('2026-11-04T12:00:00.000Z');

  describe('outboxBackoffMs', () => {
    it('computes exponential backoff capped at 5 minutes', () => {
      expect(outboxBackoffMs(1)).toBe(1000);
      expect(outboxBackoffMs(2)).toBe(2000);
      expect(outboxBackoffMs(3)).toBe(4000);
      expect(outboxBackoffMs(20)).toBe(300000);
    });
  });

  describe('InMemoryOutboxStore + OutboxRelay', () => {
    it('publishes immediately when JetStream is healthy', async () => {
      const store = new InMemoryOutboxStore();
      const relay = new OutboxRelay('test', store);
      const publishFn = jest.fn().mockResolvedValue({ seq: 1 });

      const published = await relay.publishWithOutbox(
        { eventId, tenantId, subject, payload, now: baseTime },
        publishFn,
      );

      expect(published).toBe(true);
      expect(publishFn).toHaveBeenCalledWith(subject, payload, {
        msgID: eventId,
      });
      expect(store.getAll()).toHaveLength(0);
    });

    it('queues event in outbox when JetStream fails and flushes it once NATS recovers', async () => {
      const store = new InMemoryOutboxStore();
      const relay = new OutboxRelay('test', store);
      const publishFn = jest
        .fn()
        .mockRejectedValueOnce(new Error('NATS timeout'))
        .mockResolvedValueOnce({ seq: 2 });

      const published = await relay.publishWithOutbox(
        { eventId, tenantId, subject, payload, now: baseTime },
        publishFn,
      );

      expect(published).toBe(false);
      const entries = store.getAll();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        eventId,
        tenantId,
        subject,
        status: 'PENDING',
        attempts: 1,
      });

      // Before backoff expires, nothing is flushed
      const flushedEarly = await relay.flushPending(
        publishFn,
        new Date(baseTime.getTime() + 500),
      );
      expect(flushedEarly).toBe(0);

      // Once backoff elapses, flushPending delivers the event with the original msgID
      const flushed = await relay.flushPending(
        publishFn,
        new Date(baseTime.getTime() + 1500),
      );
      expect(flushed).toBe(1);
      expect(publishFn).toHaveBeenLastCalledWith(subject, payload, {
        msgID: eventId,
      });
      expect(store.getAll()[0].status).toBe('PUBLISHED');
    });

    it('marks event as FAILED after reaching OUTBOX_MAX_ATTEMPTS', async () => {
      const store = new InMemoryOutboxStore();
      const relay = new OutboxRelay('test', store);
      await store.save({
        eventId,
        tenantId,
        subject,
        payload,
        status: 'PENDING',
        attempts: OUTBOX_MAX_ATTEMPTS - 1,
        nextRetryAt: baseTime,
        createdAt: baseTime,
        publishedAt: null,
      });

      const publishFn = jest.fn().mockRejectedValue(new Error('Still down'));
      await relay.flushPending(publishFn, baseTime);

      const updated = store.getAll()[0];
      expect(updated.status).toBe('FAILED');
      expect(updated.attempts).toBe(OUTBOX_MAX_ATTEMPTS);
    });
  });

  describe('PrismaOutboxStore transactional persistence', () => {
    it('enqueues inside a transaction and updates status on flush', async () => {
      const rows = new Map<string, any>();
      const delegate: PrismaOutboxDelegate = {
        upsert: jest.fn(async ({ where, create, update }) => {
          const existing = rows.get(where.eventId);
          if (existing) {
            Object.assign(existing, update);
            return existing;
          }
          rows.set(where.eventId, { ...create });
          return create;
        }),
        findMany: jest.fn(async ({ where }) => {
          return [...rows.values()].filter(
            (r) =>
              r.status === where.status &&
              r.nextRetryAt.getTime() <= where.nextRetryAt.lte.getTime(),
          );
        }),
        update: jest.fn(async ({ where, data }) => {
          const existing = rows.get(where.eventId);
          if (existing) Object.assign(existing, data);
          return existing;
        }),
      };

      const prismaStore = new PrismaOutboxStore(delegate);
      const relay = new OutboxRelay('organization', prismaStore);

      await relay.enqueue({
        eventId,
        tenantId,
        subject,
        payload,
        now: baseTime,
      });

      expect(delegate.upsert).toHaveBeenCalledTimes(1);
      expect(rows.get(eventId).status).toBe('PENDING');

      const publishFn = jest.fn().mockResolvedValue({ seq: 1 });
      const count = await relay.flushPending(publishFn, baseTime);

      expect(count).toBe(1);
      expect(rows.get(eventId).status).toBe('PUBLISHED');
      expect(rows.get(eventId).publishedAt).toEqual(baseTime);
    });
  });
});
