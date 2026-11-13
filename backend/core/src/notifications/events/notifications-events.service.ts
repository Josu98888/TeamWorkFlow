import { randomUUID } from 'node:crypto';
import {
  Inject,
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
} from '@nats-io/jetstream';
import type {
  ConsumerMessages,
  JetStreamClient,
  JetStreamManager,
  JsMsg,
} from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import type { NatsConnection } from '@nats-io/transport-node';
import {
  NOTIFICATIONS_STREAM,
  NOTIFICATIONS_STREAM_SUBJECTS,
} from '../notifications.patterns';
import {
  NOTIFICATIONS_DURABLE_CONSUMERS,
  notificationsEventSubject,
  subjectMatches,
  tenantIdFromSubject,
} from './notifications.events';
import type {
  ConsumedMessage,
  DurableConsumerSpec,
  NotificationsEventName,
} from './notifications.events';

export const NOTIFICATIONS_EVENTS_OPTIONS = Symbol(
  'NOTIFICATIONS_EVENTS_OPTIONS',
);

export interface NotificationsEventsOptions {
  servers: string[];
  retryInitialMs?: number;
  retryMaxMs?: number;
}

export type EventHandler = (message: ConsumedMessage) => Promise<void>;

const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
const DEFAULT_RETRY_INITIAL_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
const HANDLER_FAILED_NAK_MS = 5_000;
const HANDLER_FAILED_NAK_MAX_MS = 5 * 60_000;
const NO_HANDLER_NAK_MS = 30_000;
export const MAX_DELIVERIES = 20;

export function handlerRetryDelayMs(deliveryCount: number) {
  return Math.min(
    HANDLER_FAILED_NAK_MS * 2 ** Math.max(deliveryCount - 1, 0),
    HANDLER_FAILED_NAK_MAX_MS,
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

@Injectable()
export class NotificationsEventsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsEventsService.name);
  private readonly handlers: { filter: string; run: EventHandler }[] = [];
  private readonly running = new Set<ConsumerMessages>();
  private readonly stop = new AbortController();
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  constructor(
    @Inject(NOTIFICATIONS_EVENTS_OPTIONS)
    private readonly options: NotificationsEventsOptions,
  ) {}

  async onModuleInit() {
    this.connection = await connect({
      servers: this.options.servers,
      name: 'notifications',
    });
    this.js = jetstream(this.connection);
    this.jsm = await jetstreamManager(this.connection);
    await this.ensureStream(this.jsm);

    for (const spec of NOTIFICATIONS_DURABLE_CONSUMERS) {
      void this.startConsumer(spec);
    }
  }

  async onModuleDestroy() {
    this.stop.abort();
    await Promise.all([...this.running].map((messages) => messages.close()));
    this.running.clear();
    await this.connection?.drain().catch(() => undefined);
  }

  registerHandler(filter: string, run: EventHandler) {
    this.handlers.push({ filter, run });
  }

  async publish(
    tenantId: string,
    event: NotificationsEventName,
    payload: Record<string, unknown>,
    customEventId?: string,
  ): Promise<string> {
    if (!this.js) {
      throw new Error('JetStream is not connected');
    }
    const eventId = customEventId ?? randomUUID();
    const subject = notificationsEventSubject(tenantId, event);
    const serialized = JSON.stringify({
      ...payload,
      eventId,
      occurredAt: new Date().toISOString(),
    });
    await this.js.publish(subject, serialized, { msgID: eventId });
    return eventId;
  }

  private async ensureDurable(
    jsm: JetStreamManager,
    spec: DurableConsumerSpec,
  ) {
    try {
      await jsm.consumers.update(spec.stream, spec.durable, {
        filter_subjects: [...spec.filterSubjects],
      });
    } catch (error) {
      const notFound =
        error instanceof JetStreamApiError &&
        error.code === JetStreamApiCodes.ConsumerNotFound;
      if (!notFound) {
        throw error;
      }
      await jsm.consumers.add(spec.stream, {
        durable_name: spec.durable,
        ack_policy: AckPolicy.Explicit,
        filter_subjects: [...spec.filterSubjects],
      });
    }
  }

  private async startConsumer(spec: DurableConsumerSpec) {
    let delay = this.options.retryInitialMs ?? DEFAULT_RETRY_INITIAL_MS;
    const maxDelay = this.options.retryMaxMs ?? DEFAULT_RETRY_MAX_MS;

    while (!this.stop.signal.aborted) {
      try {
        await this.ensureDurable(this.jsm!, spec);
        const consumer = await this.js!.consumers.get(
          spec.stream,
          spec.durable,
        );
        const messages = await consumer.consume();
        this.running.add(messages);
        void this.pump(messages);
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

  private async pump(messages: ConsumerMessages) {
    for await (const message of messages) {
      if (this.stop.signal.aborted) {
        break;
      }
      await this.dispatch(message);
    }
  }

  async dispatch(message: JsMsg) {
    const handler = this.handlers.find(({ filter }) =>
      subjectMatches(filter, message.subject),
    );
    if (!handler) {
      this.logger.warn(
        `No handler registered for consumed subject ${message.subject}; backing off`,
      );
      message.nak(NO_HANDLER_NAK_MS);
      return;
    }

    try {
      const payload = message.json<unknown>();
      await handler.run({
        subject: message.subject,
        tenantId: tenantIdFromSubject(message.subject),
        payload,
      });
      message.ack();
    } catch (error) {
      const deliveries = message.info.deliveryCount;
      if (deliveries >= MAX_DELIVERIES) {
        this.logger.error(
          `Handler for ${message.subject} failed ${deliveries} times, terminating message: ${errorMessage(error)}`,
        );
        message.term();
        return;
      }
      const delay = handlerRetryDelayMs(deliveries);
      this.logger.warn(
        `Handler for ${message.subject} failed (delivery ${deliveries}/${MAX_DELIVERIES}), retrying in ${delay}ms: ${errorMessage(error)}`,
      );
      message.nak(delay);
    }
  }

  private async ensureStream(jsm: JetStreamManager) {
    const streamConfig = {
      name: NOTIFICATIONS_STREAM,
      subjects: [NOTIFICATIONS_STREAM_SUBJECTS],
      storage: StorageType.File,
      retention: RetentionPolicy.Limits,
      max_age: SEVEN_DAYS_NS,
    };
    try {
      await jsm.streams.update(NOTIFICATIONS_STREAM, streamConfig);
      this.logger.log(`Stream ${NOTIFICATIONS_STREAM} updated`);
    } catch (error) {
      const notFound =
        error instanceof JetStreamApiError &&
        error.code === JetStreamApiCodes.StreamNotFound;
      if (!notFound) {
        throw error;
      }
      await jsm.streams.add(streamConfig);
      this.logger.log(`Stream ${NOTIFICATIONS_STREAM} created`);
    }
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
