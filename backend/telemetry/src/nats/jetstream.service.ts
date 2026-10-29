import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AckPolicy,
  JetStreamApiCodes,
  JetStreamApiError,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type ConsumerMessages,
  type JetStreamClient,
  type JetStreamManager,
  type JsMsg,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { envs } from '../config';
import { JETSTREAM_STREAMS, buildAttendanceSubject } from './nats.constants';
import {
  TELEMETRY_DURABLE_CONSUMERS,
  subjectMatches,
  tenantIdFromSubject,
  type DurableConsumerSpec,
} from '../consumers/consumers.constants';

const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
const DEFAULT_RETRY_INITIAL_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const HANDLER_FAILED_NAK_MS = 5_000;
const HANDLER_FAILED_NAK_MAX_MS = 5 * 60_000;
const NO_HANDLER_NAK_MS = 30_000;
export const MAX_DELIVERIES = 20;

export interface ConsumedMessage {
  subject: string;
  tenantId: string | null;
  payload: unknown;
}

export type EventHandler = (message: ConsumedMessage) => Promise<void>;

function isApiError(error: unknown, code: number): boolean {
  return error instanceof JetStreamApiError && error.code === code;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function handlerRetryDelayMs(deliveryCount: number): number {
  return Math.min(
    HANDLER_FAILED_NAK_MS * 2 ** Math.max(deliveryCount - 1, 0),
    HANDLER_FAILED_NAK_MAX_MS,
  );
}

@Injectable()
export class JetStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JetStreamService.name);
  private readonly handlers: { filter: string; run: EventHandler }[] = [];
  private readonly running = new Set<ConsumerMessages>();
  private readonly stop = new AbortController();
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  async onModuleInit() {
    try {
      this.connection = await connect({
        servers: envs.natsServers,
        name: 'telemetry-jetstream',
      });
      this.js = jetstream(this.connection);
      this.jsm = await jetstreamManager(this.connection);
      await this.ensureOwnStream();
      this.logger.log('JetStream connected and attendance stream ready');

      for (const spec of TELEMETRY_DURABLE_CONSUMERS) {
        void this.startConsumer(spec);
      }
    } catch (err) {
      this.logger.warn(
        `Could not connect to JetStream on init: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    this.stop.abort();
    await Promise.all([...this.running].map((messages) => messages.close()));
    this.running.clear();
    await this.connection?.drain().catch(() => undefined);
  }

  registerHandler(filter: string, run: EventHandler): void {
    this.handlers.push({ filter, run });
  }

  private async ensureOwnStream() {
    if (!this.jsm) return;
    try {
      await this.jsm.streams.info(JETSTREAM_STREAMS.ATTENDANCE);
    } catch {
      try {
        await this.jsm.streams.add({
          name: JETSTREAM_STREAMS.ATTENDANCE,
          subjects: ['t.*.attendance.>'],
          retention: RetentionPolicy.Limits,
          storage: StorageType.File,
          max_age: SEVEN_DAYS_NS,
        });
        this.logger.log(
          `Created JetStream stream ${JETSTREAM_STREAMS.ATTENDANCE}`,
        );
      } catch (addErr) {
        this.logger.warn(
          `Stream creation error: ${addErr instanceof Error ? addErr.message : String(addErr)}`,
        );
      }
    }
  }

  private async ensureDurable(
    jsm: JetStreamManager,
    spec: DurableConsumerSpec,
  ): Promise<void> {
    try {
      await jsm.consumers.update(spec.stream, spec.durable, {
        filter_subjects: spec.filterSubjects,
      });
    } catch (error) {
      if (!isApiError(error, JetStreamApiCodes.ConsumerNotFound)) {
        throw error;
      }
      await jsm.consumers.add(spec.stream, {
        durable_name: spec.durable,
        ack_policy: AckPolicy.Explicit,
        filter_subjects: spec.filterSubjects,
      });
    }
  }

  private async startConsumer(spec: DurableConsumerSpec): Promise<void> {
    let delay = DEFAULT_RETRY_INITIAL_MS;
    const maxDelay = DEFAULT_RETRY_MAX_MS;

    while (!this.stop.signal.aborted) {
      try {
        if (!this.jsm || !this.js) return;
        await this.ensureDurable(this.jsm, spec);
        const consumer = await this.js.consumers.get(
          spec.stream,
          spec.durable,
        );
        const messages = await consumer.consume();
        this.running.add(messages);
        void this.pump(spec, messages);
        return;
      } catch (error) {
        this.logger.warn(
          `Consumer ${spec.durable} not ready, retrying in ${delay}ms: ${errorMessage(error)}`,
        );
        await this.sleep(delay);
        delay = Math.min(delay * 2, maxDelay);
      }
    }
  }

  private async pump(
    spec: DurableConsumerSpec,
    messages: ConsumerMessages,
  ): Promise<void> {
    try {
      for await (const message of messages) {
        await this.dispatch(message);
      }
    } catch (error) {
      this.logger.error(
        `Consumer ${spec.durable} stopped: ${errorMessage(error)}`,
      );
    }
    this.running.delete(messages);
    if (!this.stop.signal.aborted) {
      void this.startConsumer(spec);
    }
  }

  private async dispatch(message: JsMsg): Promise<void> {
    const handler = this.handlers.find(({ filter }) =>
      subjectMatches(filter, message.subject),
    );
    if (!handler) {
      this.logger.warn(`No handler for ${message.subject}, redelivering later`);
      message.nak(NO_HANDLER_NAK_MS);
      return;
    }

    let payload: unknown;
    try {
      payload = message.json();
    } catch {
      this.logger.error(`Invalid payload on ${message.subject}, discarding`);
      message.term('invalid payload');
      return;
    }

    try {
      await handler.run({
        subject: message.subject,
        tenantId: tenantIdFromSubject(message.subject),
        payload,
      });
      message.ack();
    } catch {
      const deliveries = message.info.deliveryCount;
      if (deliveries >= MAX_DELIVERIES) {
        this.logger.error(
          `Handler failed for ${message.subject} after ${deliveries} deliveries, giving up`,
        );
        message.term('max deliveries reached');
        return;
      }
      this.logger.error(
        `Handler failed for ${message.subject}, will be redelivered`,
      );
      message.nak(handlerRetryDelayMs(deliveries));
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(done, ms);
      const signal = this.stop.signal;
      function done() {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        resolve();
      }
      signal.addEventListener('abort', done, { once: true });
    });
  }

  async publish<T extends object>(
    tenantId: string,
    eventName: string,
    payload: T,
  ): Promise<void> {
    try {
      if (!this.js) {
        if (!this.connection) {
          this.connection = await connect({
            servers: envs.natsServers,
            name: 'telemetry-jetstream',
          });
        }
        this.js = jetstream(this.connection);
      }

      const p = payload as Record<string, unknown>;
      const eventId =
        (typeof p.eventId === 'string' ? p.eventId : undefined) ??
        randomUUID();
      const body = {
        ...payload,
        eventId,
        tenantId,
        occurredAt:
          (typeof p.occurredAt === 'string' ? p.occurredAt : undefined) ??
          new Date().toISOString(),
      };

      const subject = buildAttendanceSubject(tenantId, eventName);
      await this.js.publish(subject, JSON.stringify(body), { msgID: eventId });
    } catch (error) {
      this.logger.error(
        `Failed to publish attendance event ${eventName} for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
