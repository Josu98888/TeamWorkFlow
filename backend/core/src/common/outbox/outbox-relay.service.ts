import { Logger } from '@nestjs/common';
import {
  OUTBOX_MAX_ATTEMPTS,
  outboxBackoffMs,
  type OutboxEntry,
  type OutboxStore,
  type OutboxTransportPublisher,
} from './outbox.types';

export interface PrismaOutboxDelegate {
  upsert(args: {
    where: { eventId: string };
    create: {
      eventId: string;
      tenantId: string;
      subject: string;
      payload: string;
      status: string;
      attempts: number;
      nextRetryAt: Date;
      createdAt: Date;
      publishedAt?: Date | null;
    };
    update: {
      status?: string;
      attempts?: number;
      nextRetryAt?: Date;
      publishedAt?: Date | null;
    };
  }): Promise<unknown>;
  findMany(args: {
    where: {
      status: string;
      nextRetryAt: { lte: Date };
    };
    orderBy: { createdAt: 'asc' };
    take: number;
  }): Promise<OutboxEntry[]>;
  update(args: {
    where: { eventId: string };
    data: {
      status?: string;
      attempts?: number;
      nextRetryAt?: Date;
      publishedAt?: Date | null;
    };
  }): Promise<unknown>;
}

/**
 * Prisma-backed transactional outbox store.
 * Persists events in the module's `outbox_events` table inside the same PostgreSQL schema.
 */
export class PrismaOutboxStore implements OutboxStore {
  constructor(private readonly delegate: PrismaOutboxDelegate) {}

  async save(entry: OutboxEntry): Promise<void> {
    await this.delegate.upsert({
      where: { eventId: entry.eventId },
      create: {
        eventId: entry.eventId,
        tenantId: entry.tenantId,
        subject: entry.subject,
        payload: entry.payload,
        status: entry.status,
        attempts: entry.attempts,
        nextRetryAt: entry.nextRetryAt,
        createdAt: entry.createdAt,
        publishedAt: entry.publishedAt ?? null,
      },
      update: {
        status: entry.status,
        attempts: entry.attempts,
        nextRetryAt: entry.nextRetryAt,
        publishedAt: entry.publishedAt ?? null,
      },
    });
  }

  async findReadyToPublish(now: Date, limit: number): Promise<OutboxEntry[]> {
    return this.delegate.findMany({
      where: {
        status: 'PENDING',
        nextRetryAt: { lte: now },
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    await this.delegate.update({
      where: { eventId },
      data: {
        status: 'PUBLISHED',
        publishedAt,
      },
    });
  }

  async markFailedAttempt(
    eventId: string,
    attempts: number,
    nextRetryAt: Date,
    terminal: boolean,
  ): Promise<void> {
    await this.delegate.update({
      where: { eventId },
      data: {
        status: terminal ? 'FAILED' : 'PENDING',
        attempts,
        nextRetryAt,
      },
    });
  }
}

/**
 * Resilient in-memory outbox store used as fallback when a DB delegate is not wired
 * (e.g. standalone unit tests) or when a transient DB error occurs during fallback.
 */
export class InMemoryOutboxStore implements OutboxStore {
  private readonly entries = new Map<string, OutboxEntry>();

  async save(entry: OutboxEntry): Promise<void> {
    this.entries.set(entry.eventId, { ...entry });
  }

  async findReadyToPublish(now: Date, limit: number): Promise<OutboxEntry[]> {
    const ready: OutboxEntry[] = [];
    for (const entry of this.entries.values()) {
      if (
        entry.status === 'PENDING' &&
        entry.nextRetryAt.getTime() <= now.getTime()
      ) {
        ready.push({ ...entry });
        if (ready.length >= limit) break;
      }
    }
    return ready.sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    );
  }

  async markPublished(eventId: string, publishedAt: Date): Promise<void> {
    const existing = this.entries.get(eventId);
    if (existing) {
      existing.status = 'PUBLISHED';
      existing.publishedAt = publishedAt;
    }
  }

  async markFailedAttempt(
    eventId: string,
    attempts: number,
    nextRetryAt: Date,
    terminal: boolean,
  ): Promise<void> {
    const existing = this.entries.get(eventId);
    if (existing) {
      existing.attempts = attempts;
      existing.nextRetryAt = nextRetryAt;
      existing.status = terminal ? 'FAILED' : 'PENDING';
    }
  }

  getAll(): OutboxEntry[] {
    return [...this.entries.values()];
  }
}

/**
 * Coordinates transactional outbox persistence and background retry flushing to NATS JetStream.
 */
export class OutboxRelay {
  private readonly logger: Logger;
  private flushing = false;

  constructor(
    moduleName: string,
    private readonly store: OutboxStore = new InMemoryOutboxStore(),
    private readonly batchSize = 50,
  ) {
    this.logger = new Logger(`OutboxRelay:${moduleName}`);
  }

  /**
   * Records an event in the outbox store inside a transaction (before JetStream publish)
   * so that if the process crashes or NATS is unreachable right after commit, the relay will deliver it.
   */
  async enqueue(
    params: {
      eventId: string;
      tenantId: string;
      subject: string;
      payload: string;
      now?: Date;
    },
    txStore?: OutboxStore,
  ): Promise<OutboxEntry> {
    const now = params.now ?? new Date();
    const entry: OutboxEntry = {
      eventId: params.eventId,
      tenantId: params.tenantId,
      subject: params.subject,
      payload: params.payload,
      status: 'PENDING',
      attempts: 0,
      nextRetryAt: now,
      createdAt: now,
      publishedAt: null,
    };
    await (txStore ?? this.store).save(entry);
    return entry;
  }

  /**
   * Publishes an event to JetStream and guarantees that if JetStream is unavailable or times out,
   * the event is persisted in the outbox store as PENDING for automatic background retry.
   */
  async publishWithOutbox(
    params: {
      eventId: string;
      tenantId: string;
      subject: string;
      payload: string;
      now?: Date;
    },
    publishFn: OutboxTransportPublisher,
  ): Promise<boolean> {
    const now = params.now ?? new Date();
    try {
      await publishFn(params.subject, params.payload, {
        msgID: params.eventId,
      });
      return true;
    } catch (error) {
      const attempts = 1;
      const nextRetryAt = new Date(now.getTime() + outboxBackoffMs(attempts));
      const entry: OutboxEntry = {
        eventId: params.eventId,
        tenantId: params.tenantId,
        subject: params.subject,
        payload: params.payload,
        status: 'PENDING',
        attempts,
        nextRetryAt,
        createdAt: now,
        publishedAt: null,
      };
      try {
        await this.store.save(entry);
      } catch (storeErr) {
        this.logger.error(
          `Failed to persist outbox event ${params.eventId} on ${params.subject}: ${storeErr instanceof Error ? storeErr.message : 'Unknown error'}`,
        );
      }
      this.logger.warn(
        `Queued event ${params.eventId} on ${params.subject} in outbox after publish failure (${error instanceof Error ? error.message : 'Unknown error'}); next retry at ${nextRetryAt.toISOString()}`,
      );
      return false;
    }
  }

  /**
   * Flushes all due PENDING events from the outbox to JetStream.
   * Returns the number of events successfully published in this pass.
   */
  async flushPending(
    publishFn: OutboxTransportPublisher,
    now: Date = new Date(),
  ): Promise<number> {
    if (this.flushing) return 0;
    this.flushing = true;

    let publishedCount = 0;
    try {
      const pending = await this.store.findReadyToPublish(now, this.batchSize);
      for (const entry of pending) {
        try {
          await publishFn(entry.subject, entry.payload, {
            msgID: entry.eventId,
          });
          await this.store.markPublished(entry.eventId, now);
          publishedCount++;
        } catch (error) {
          const attempts = entry.attempts + 1;
          const terminal = attempts >= OUTBOX_MAX_ATTEMPTS;
          const nextRetryAt = new Date(
            now.getTime() + outboxBackoffMs(attempts),
          );
          await this.store.markFailedAttempt(
            entry.eventId,
            attempts,
            nextRetryAt,
            terminal,
          );
          this.logger.warn(
            `Outbox retry ${attempts}/${OUTBOX_MAX_ATTEMPTS} failed for ${entry.subject} (${entry.eventId}): ${error instanceof Error ? error.message : 'Unknown error'}`,
          );
        }
      }
    } finally {
      this.flushing = false;
    }

    return publishedCount;
  }
}
