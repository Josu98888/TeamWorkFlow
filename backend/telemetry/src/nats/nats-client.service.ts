import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { connect, NatsConnection } from '@nats-io/transport-node';
import { envs } from '../config';
import { NATS_PATTERNS } from './nats.constants';
import {
  AppException,
  AppErrorCode,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
} from '../common/exceptions';
import type {
  EmployeeDto,
  ShiftDto,
  SiteDto,
  VerifiedActor,
} from './dto/nats-contracts';

function encodeJson(data: unknown): Uint8Array {
  return Buffer.from(JSON.stringify(data));
}

function decodeJson(data: Uint8Array): unknown {
  return JSON.parse(Buffer.from(data).toString('utf-8'));
}

@Injectable()
export class NatsClientService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NatsClientService.name);
  private connection?: NatsConnection;

  async onModuleInit() {
    try {
      this.connection = await connect({
        servers: envs.natsServers,
        name: 'telemetry-rpc',
        timeout: envs.natsTimeoutMs,
      });
      this.logger.log(`NATS connected to ${envs.natsServers.join(', ')}`);
    } catch (err) {
      this.logger.warn(
        `Could not connect to NATS on init: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async onModuleDestroy() {
    await this.connection?.drain().catch(() => undefined);
  }

  async request<TReq, TRes>(
    subject: string,
    data: TReq,
    timeoutMs?: number,
  ): Promise<TRes> {
    if (!this.connection) {
      try {
        this.connection = await connect({
          servers: envs.natsServers,
          name: 'telemetry-rpc',
          timeout: timeoutMs ?? envs.natsTimeoutMs,
        });
      } catch {
        throw new UpstreamUnavailableException('NATS broker');
      }
    }

    try {
      const response = await this.connection.request(
        subject,
        encodeJson(data),
        { timeout: timeoutMs ?? envs.natsTimeoutMs },
      );

      const decoded = decodeJson(response.data) as unknown;

      if (
        decoded &&
        typeof decoded === 'object' &&
        'status' in decoded &&
        'code' in decoded &&
        'message' in decoded &&
        typeof (decoded as { status: number }).status === 'number' &&
        (decoded as { status: number }).status >= 400
      ) {
        const errorBody = decoded as {
          status: number;
          code: AppErrorCode;
          message: string;
          errors?: import('../common/exceptions').ValidationErrorItem[];
        };
        throw new AppException(
          errorBody.status,
          errorBody.code,
          errorBody.message,
          errorBody.errors,
        );
      }

      return decoded as TRes;
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }

      const err = error as { code?: string; name?: string; message?: string };
      const code = err?.code || err?.name;
      if (code === 'TIMEOUT' || err?.message?.toLowerCase().includes('timeout')) {
        throw new UpstreamTimeoutException(subject);
      }
      if (
        code === 'NO_RESPONDERS' ||
        code === 'CONNECTION_REFUSED' ||
        err?.message?.toLowerCase().includes('no responders')
      ) {
        throw new UpstreamUnavailableException(subject);
      }

      this.logger.error(
        `NATS request to ${subject} failed: ${err?.message ?? String(error)}`,
      );
      throw new UpstreamUnavailableException(subject);
    }
  }

  async verifyToken(accessToken: string): Promise<VerifiedActor> {
    return this.request<{ accessToken: string }, VerifiedActor>(
      NATS_PATTERNS.AUTH_TOKEN_VERIFY,
      { accessToken },
    );
  }

  async getEmployee(tenantId: string, userId: string): Promise<EmployeeDto> {
    return this.request<{ tenantId: string; userId: string }, EmployeeDto>(
      NATS_PATTERNS.ORGANIZATION_EMPLOYEE_GET,
      { tenantId, userId },
    );
  }

  async getSite(tenantId: string, siteId: string): Promise<SiteDto> {
    return this.request<{ tenantId: string; siteId: string }, SiteDto>(
      NATS_PATTERNS.ORGANIZATION_SITE_GET,
      { tenantId, siteId },
    );
  }

  async getShift(tenantId: string, shiftId: string): Promise<ShiftDto> {
    return this.request<{ tenantId: string; shiftId: string }, ShiftDto>(
      NATS_PATTERNS.ORGANIZATION_SHIFT_GET,
      { tenantId, shiftId },
    );
  }
}
