import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../prisma/generated/client';
import { OrganizationPrismaService } from '../prisma/prisma.service';
import type { ConsumedMessage, ConsumedSubject } from './consumed-events';
import { OrganizationEventsService } from './organization-events.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Runs after the transaction committed. It must not throw; the processor logs
// and ignores a failing effect anyway.
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

// Thrown by a handler when the envelope is fine but the event-specific fields
// are invalid. It can never succeed: the transaction rolls back, it is logged
// without the payload and the message is acked (no redelivery).
export class PoisonEventError extends Error {
  constructor() {
    super('Invalid event payload');
    this.name = 'PoisonEventError';
  }
}

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

// Shared pipeline of every consumed event (AGENTS § Events consumed): validate
// the envelope, check the subject tenant against the payload, deduplicate by
// `eventId` in `ProcessedEvent` inside the same transaction as the handler,
// and run the post-commit effects after the commit. The events service acks
// when `process` resolves (always after the commit) and naks when it throws.
@Injectable()
export class ConsumedEventProcessor {
  private readonly logger = new Logger(ConsumedEventProcessor.name);

  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly events: OrganizationEventsService,
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
        // Never log the error message: it may carry user data.
        this.logger.error(`A post-commit effect failed for ${message.subject}`);
      }
    }
  }

  // Poison messages (malformed envelope, subject/payload tenant mismatch) can
  // never succeed: logged without the payload and acked by returning normally.
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
