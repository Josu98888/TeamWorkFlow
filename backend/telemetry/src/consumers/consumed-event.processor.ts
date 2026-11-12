import { Injectable, Logger } from '@nestjs/common';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { JetStreamService, type ConsumedMessage } from '../nats/jetstream.service';
import type { Prisma } from '../prisma/generated/client';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  filter: string;
  handle(
    context: ConsumedEventContext,
  ): Promise<PostCommitEffect[] | void> | PostCommitEffect[] | void;
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
  if (typeof eventId !== 'string' || !UUID_REGEX.test(eventId)) return null;
  if (typeof tenantId !== 'string' || !UUID_REGEX.test(tenantId)) return null;
  if (typeof occurredAt !== 'string') return null;
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  return { eventId, tenantId, occurredAt: date, payload: raw };
}

@Injectable()
export class ConsumedEventProcessor {
  private readonly logger = new Logger(ConsumedEventProcessor.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly jetstream: JetStreamService,
  ) {}

  register(handler: ConsumedEventHandler): void {
    this.jetstream.registerHandler(handler.filter, (message) =>
      this.process(handler, message),
    );
  }

  async process(
    handler: ConsumedEventHandler,
    message: ConsumedMessage,
  ): Promise<void> {
    const envelope = this.accept(message);
    if (!envelope) return;

    let effects: PostCommitEffect[] = [];
    try {
      effects = await this.prisma.$transaction(async (tx) => {
        const inserted = await tx.processedEvent.createMany({
          data: [
            {
              eventId: envelope.eventId,
              tenantId: envelope.tenantId,
              eventType: message.subject,
            },
          ],
          skipDuplicates: true,
        });

        if (inserted.count === 0) {
          this.logger.debug(
            `Duplicate event ${envelope.eventId} on ${message.subject} ignored`,
          );
          return [];
        }

        const result = await handler.handle({ ...envelope, tx });
        return Array.isArray(result) ? result : [];
      });
    } catch (error) {
      if (error instanceof PoisonEventError) {
        this.logger.error(
          `Discarding poison event ${envelope.eventId} on ${message.subject}: ${error.message}`,
        );
        return;
      }
      throw error;
    }

    for (const effect of effects) {
      try {
        await effect();
      } catch (err) {
        this.logger.error(
          `Post-commit effect failed for event ${envelope.eventId} on ${message.subject}: ${err instanceof Error ? err.message : String(err)}`,
        );
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
        `Discarding event with tenant mismatch on ${message.subject} (subject: ${message.tenantId}, payload: ${envelope.tenantId})`,
      );
      return null;
    }
    return envelope;
  }
}
