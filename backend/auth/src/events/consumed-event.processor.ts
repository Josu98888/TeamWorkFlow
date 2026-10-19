import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ConsumedSubject } from './auth.events';
import { JetStreamService } from './jetstream.service';
import type { ConsumedMessage } from './jetstream.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runs after the transaction committed (for example publishing an event). It
// must not throw; the processor logs and ignores a failing effect anyway.
export type PostCommitEffect = () => Promise<void>;

export interface ConsumedEventContext {
  // Equal to the tenant of the subject AND of the payload (checked already).
  tenantId: string;
  eventId: string;
  occurredAt: Date;
  // The whole payload, for the fields specific to the event.
  payload: Record<string, unknown>;
  // Same transaction as the `ProcessedEvent` row: if the handler throws, both roll back.
  tx: Prisma.TransactionClient;
}

// Thrown by a handler when the payload is well-formed as an envelope but its
// event-specific fields are invalid. It can never succeed, so the processor
// rolls the transaction back, logs without the payload and acks (no redelivery).
export class PoisonEventError extends Error {
  constructor() {
    super('Invalid event payload');
    this.name = 'PoisonEventError';
  }
}

// One handler per consumed subject filter (S7.x, S8.1).
export interface ConsumedEventHandler {
  filter: ConsumedSubject;
  handle(context: ConsumedEventContext): Promise<PostCommitEffect[]>;
}

interface Envelope {
  eventId: string;
  tenantId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseEnvelope(raw: unknown): Envelope | null {
  if (!isRecord(raw)) return null;
  const { eventId, tenantId, occurredAt } = raw;
  if (typeof eventId !== 'string' || !UUID.test(eventId)) return null;
  if (typeof tenantId !== 'string' || !UUID.test(tenantId)) return null;
  if (typeof occurredAt !== 'string') return null;
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  return { eventId, tenantId, occurredAt: date, payload: raw };
}

// Shared pipeline of every consumed event (AGENTS § Events consumed, STEPS
// Phase 7): validate the envelope, check the subject tenant against the
// payload, deduplicate by `eventId` in `ProcessedEvent` inside the same
// transaction as the handler, and run the post-commit effects after the commit.
// `JetStreamService` acks when `process` resolves (always after the commit) and
// naks when it throws (transient failure, bounded redelivery).
@Injectable()
export class ConsumedEventProcessor {
  private readonly logger = new Logger(ConsumedEventProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: JetStreamService,
  ) {}

  register(handler: ConsumedEventHandler) {
    this.events.registerHandler(handler.filter, (message) =>
      this.process(handler, message),
    );
  }

  async process(handler: ConsumedEventHandler, message: ConsumedMessage) {
    const envelope = this.accept(message);
    if (!envelope) return;

    let effects: PostCommitEffect[];
    try {
      effects = await this.prisma.$transaction(async (tx) => {
        // ON CONFLICT DO NOTHING: a duplicate neither fails nor aborts the
        // transaction, and a concurrent duplicate waits for the first commit.
        const inserted = await tx.processedEvent.createMany({
          data: [{ eventId: envelope.eventId, tenantId: envelope.tenantId }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return [];
        return handler.handle({ ...envelope, tx });
      });
    } catch (error) {
      if (error instanceof PoisonEventError) {
        // Rolled back (the eventId is not recorded) and acked by returning.
        this.logger.error(`Discarding invalid event on ${message.subject}`);
        return;
      }
      throw error;
    }

    for (const effect of effects) {
      try {
        await effect();
      } catch {
        // Never log the error message: it may carry user data. The data is
        // already committed (DEFAULT(auth): no outbox).
        this.logger.error(`A post-commit effect failed for ${message.subject}`);
      }
    }
  }

  // Poison messages (malformed envelope, subject/payload tenant mismatch) can
  // never succeed: they are logged without the payload and acked by returning
  // normally. Single place for the tenant check (S7.5).
  private accept(message: ConsumedMessage): Envelope | null {
    const envelope = parseEnvelope(message.payload);
    if (!envelope) {
      this.logger.error(`Discarding malformed event on ${message.subject}`);
      return null;
    }
    if (message.tenantId !== envelope.tenantId) {
      this.logger.error(
        `Discarding event with a tenant mismatch on ${message.subject}`,
      );
      return null;
    }
    return envelope;
  }
}
