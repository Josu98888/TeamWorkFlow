import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../prisma/generated/client';
import { BillingPrismaService } from '../prisma/prisma.service';
import { BillingEventsService } from './billing-events.service';
import type { ConsumedMessage, ConsumedSubject } from './consumed-events';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PostCommitEffect = () => Promise<void>;

export interface ConsumedEventContext {
  tenantId: string;
  eventId: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
  tx: Prisma.TransactionClient;
}

export class PoisonEventError extends Error {
  constructor(message = 'Invalid event payload') {
    super(message);
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

@Injectable()
export class ConsumedEventProcessor {
  private readonly logger = new Logger(ConsumedEventProcessor.name);

  constructor(
    private readonly prisma: BillingPrismaService,
    private readonly events: BillingEventsService,
  ) {}

  register(handler: ConsumedEventHandler): void {
    this.events.registerHandler(handler.filter, (message) =>
      this.process(handler, message),
    );
  }

  async process(
    handler: ConsumedEventHandler,
    message: ConsumedMessage,
  ): Promise<void> {
    const envelope = this.accept(message);
    if (!envelope) return;

    let effects: PostCommitEffect[];
    try {
      effects = await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.processedEvent.createMany({
          data: [{ eventId: envelope.eventId, tenantId: envelope.tenantId }],
          skipDuplicates: true,
        });
        if (inserted.count === 0) return [];
        return handler.handle({ ...envelope, tx });
      });
    } catch (error) {
      if (error instanceof PoisonEventError) {
        this.logger.error(`Discarding poison event on ${message.subject}`);
        return;
      }
      throw error;
    }

    for (const effect of effects) {
      try {
        await effect();
      } catch {
        this.logger.error(`A post-commit effect failed for ${message.subject}`);
      }
    }
  }

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
