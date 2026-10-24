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
  AUTH_DURABLE_CONSUMERS,
  AUTH_STREAM,
  AUTH_STREAM_SUBJECTS,
  authEventSubject,
  subjectMatches,
  tenantIdFromSubject,
} from './auth.events';
import type {
  AuthEventName,
  AuthEventPayloads,
  ConsumedSubject,
  DurableConsumerSpec,
} from './auth.events';

export const JETSTREAM_OPTIONS = Symbol('JETSTREAM_OPTIONS');

export interface JetStreamServiceOptions {
  servers: string[];
  // Backoff while a producer's stream does not exist yet (durable creation).
  retryInitialMs?: number;
  retryMaxMs?: number;
}

export interface ConsumedMessage {
  subject: string;
  // Tenant taken from the subject; the handler must check it against the payload.
  tenantId: string | null;
  payload: unknown;
}

export type EventHandler = (message: ConsumedMessage) => Promise<void>;

const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;
const DEFAULT_RETRY_INITIAL_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 30_000;
// Redelivery delays for messages that were not acked.
const HANDLER_FAILED_NAK_MS = 5_000;
const HANDLER_FAILED_NAK_MAX_MS = 5 * 60_000;
const NO_HANDLER_NAK_MS = 30_000;
// A message whose handler keeps failing is given up after this many deliveries
// (about 1.5 hours with the backoff above), so a poison message cannot loop forever.
export const MAX_DELIVERIES = 20;

// 5s, 10s, 20s, ... capped at 5 minutes.
export function handlerRetryDelayMs(deliveryCount: number) {
  return Math.min(
    HANDLER_FAILED_NAK_MS * 2 ** Math.max(deliveryCount - 1, 0),
    HANDLER_FAILED_NAK_MAX_MS,
  );
}

function errorName(error: unknown) {
  return error instanceof Error ? error.name : 'UnknownError';
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isApiError(error: unknown, code: number) {
  return error instanceof JetStreamApiError && error.code === code;
}

// Wraps `@nats-io/jetstream` (backend STEPS S1.3): Nest's NATS transport does
// not create durable JetStream consumers, so events go through this service.
@Injectable()
export class JetStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JetStreamService.name);
  private readonly handlers: { filter: ConsumedSubject; run: EventHandler }[] =
    [];
  private readonly running = new Set<ConsumerMessages>();
  private readonly stop = new AbortController();
  private connection?: NatsConnection;
  private js?: JetStreamClient;
  private jsm?: JetStreamManager;

  constructor(
    @Inject(JETSTREAM_OPTIONS)
    private readonly options: JetStreamServiceOptions,
  ) {}

  async onModuleInit() {
    this.connection = await connect({
      servers: this.options.servers,
      name: 'auth',
    });
    this.js = jetstream(this.connection);
    this.jsm = await jetstreamManager(this.connection);

    await this.ensureOwnStream(this.jsm);

    // Not awaited: a producer that is not up yet must not block startup.
    for (const spec of AUTH_DURABLE_CONSUMERS) {
      void this.startConsumer(spec);
    }
  }

  async onModuleDestroy() {
    this.stop.abort();
    await Promise.all([...this.running].map((messages) => messages.close()));
    this.running.clear();
    await this.connection?.drain().catch(() => undefined);
  }

  // Registers the handler of one consumed subject filter. A message is acked
  // only after the handler resolves.
  registerHandler(filter: ConsumedSubject, run: EventHandler) {
    this.handlers.push({ filter, run });
  }

  // Publishes `t.<tenantId>.auth.<event>` and waits for the stream ack. Per
  // DEFAULT(auth) a failure is logged without the payload and not retried; it
  // never throws, so a use case that already committed is not rolled back.
  async publish<E extends AuthEventName>(
    tenantId: string,
    event: E,
    payload: AuthEventPayloads[E],
  ) {
    try {
      if (!this.js) {
        throw new Error('JetStream is not connected');
      }
      const eventId = randomUUID();
      const body = {
        ...payload,
        eventId,
        occurredAt: new Date().toISOString(),
      };
      await this.js.publish(
        authEventSubject(tenantId, event),
        JSON.stringify(body),
        { msgID: eventId },
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish ${event} event: ${errorMessage(error)}`,
      );
    }
  }

  private async ensureOwnStream(jsm: JetStreamManager) {
    // Storage and retention cannot change on an existing stream, so only the
    // updatable fields are sent on update.
    const updatable = {
      subjects: [AUTH_STREAM_SUBJECTS],
      max_age: SEVEN_DAYS_NS,
    };
    try {
      await jsm.streams.update(AUTH_STREAM, updatable);
    } catch (error) {
      if (!isApiError(error, JetStreamApiCodes.StreamNotFound)) {
        throw error;
      }
      await jsm.streams.add({
        name: AUTH_STREAM,
        ...updatable,
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
      });
    }
  }

  private async ensureDurable(
    jsm: JetStreamManager,
    spec: DurableConsumerSpec,
  ) {
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

  // Creates the durable and starts consuming. While the producer's stream does
  // not exist yet (or the server fails) it retries with exponential backoff.
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

  private async pump(spec: DurableConsumerSpec, messages: ConsumerMessages) {
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

  private async dispatch(message: JsMsg) {
    const handler = this.handlers.find(({ filter }) =>
      subjectMatches(filter, message.subject),
    );
    if (!handler) {
      // Not acked: the event stays in the stream until a handler exists.
      this.logger.warn(`No handler for ${message.subject}, redelivering later`);
      message.nak(NO_HANDLER_NAK_MS);
      return;
    }

    let payload: unknown;
    try {
      payload = message.json();
    } catch {
      // A payload that cannot be parsed will never succeed: stop redelivery.
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
    } catch (error) {
      // Never log the payload or the error message: either may carry user data.
      const deliveries = message.info.deliveryCount;
      if (deliveries >= MAX_DELIVERIES) {
        this.logger.error(
          `Handler failed for ${message.subject} (${errorName(error)}) after ${deliveries} deliveries, giving up`,
        );
        message.term('max deliveries reached');
        return;
      }
      this.logger.error(
        `Handler failed for ${message.subject} (${errorName(error)}), will be redelivered`,
      );
      message.nak(handlerRetryDelayMs(deliveries));
    }
  }

  private sleep(ms: number) {
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
}
