import { randomUUID } from 'node:crypto';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  RetentionPolicy,
  StorageType,
  jetstream,
  jetstreamManager,
  type JetStreamClient,
  type JetStreamManager,
} from '@nats-io/jetstream';
import { connect, type NatsConnection } from '@nats-io/transport-node';
import { envs } from '../config';
import { JETSTREAM_STREAMS, buildAttendanceSubject } from './nats.constants';

const SEVEN_DAYS_NS = 7 * 24 * 60 * 60 * 1_000_000_000;

@Injectable()
export class JetStreamService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JetStreamService.name);
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
    } catch (err) {
      this.logger.warn(
        `Could not connect to JetStream on init: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.connection?.drain().catch(() => undefined);
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
      const eventId = (typeof p.eventId === 'string' ? p.eventId : undefined) ?? randomUUID();
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
