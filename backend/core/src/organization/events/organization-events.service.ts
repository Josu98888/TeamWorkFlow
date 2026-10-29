import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  JetStreamApiCodes,
  JetStreamApiError,
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
} from '@nats-io/jetstream';
import type { JetStreamClient, JetStreamManager } from '@nats-io/jetstream';
import { connect } from '@nats-io/transport-node';
import type { NatsConnection } from '@nats-io/transport-node';
import {
  ORGANIZATION_STREAM,
  ORGANIZATION_STREAM_SUBJECTS,
  organizationEventSubject,
} from '../organization.patterns';
import type { OrganizationEventName } from '../organization.patterns';

export const ORGANIZATION_EVENTS_OPTIONS = Symbol(
  'ORGANIZATION_EVENTS_OPTIONS',
);

export interface OrganizationEventsOptions {
  servers: string[];
}

const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown error';
}

// Owned by `organization`: a module never imports another module's internals,
// so this is not `auth`'s JetStreamService. It creates the ORGANIZATION_EVENTS
// stream on startup and publishes `t.<tenant>.organization.<event>`. The
// consumers of `auth` events are added with the sub-modules that handle them.
@Injectable()
export class OrganizationEventsService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(OrganizationEventsService.name);
  private connection?: NatsConnection;
  private js?: JetStreamClient;

  constructor(
    @Inject(ORGANIZATION_EVENTS_OPTIONS)
    private readonly options: OrganizationEventsOptions,
  ) {}

  async onModuleInit() {
    this.connection = await connect({
      servers: this.options.servers,
      name: 'organization',
    });
    this.js = jetstream(this.connection);
    await this.ensureStream(await jetstreamManager(this.connection));
  }

  async onModuleDestroy() {
    await this.connection?.drain().catch(() => undefined);
  }

  // Publishes and waits for the stream ack. A failure is logged without the
  // payload and never thrown, so a use case that already committed is not
  // rolled back (AGENTS § Events emitted).
  async publish(
    tenantId: string,
    event: OrganizationEventName,
    payload: Record<string, unknown>,
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
        organizationEventSubject(tenantId, event),
        JSON.stringify(body),
        { msgID: eventId },
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish ${event} event: ${errorMessage(error)}`,
      );
    }
  }

  private async ensureStream(jsm: JetStreamManager) {
    // Storage and retention cannot change on an existing stream, so only the
    // updatable fields are sent on update.
    const updatable = {
      subjects: [ORGANIZATION_STREAM_SUBJECTS],
      max_age: SEVEN_DAYS_NS,
    };
    try {
      await jsm.streams.update(ORGANIZATION_STREAM, updatable);
    } catch (error) {
      const notFound =
        error instanceof JetStreamApiError &&
        error.code === JetStreamApiCodes.StreamNotFound;
      if (!notFound) {
        throw error;
      }
      await jsm.streams.add({
        name: ORGANIZATION_STREAM,
        ...updatable,
        storage: StorageType.File,
        retention: RetentionPolicy.Limits,
      });
    }
  }
}
