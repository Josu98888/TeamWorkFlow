import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { firstValueFrom, TimeoutError, timeout } from 'rxjs';
import { envs } from '../config';
import { NATS_PATTERNS, NATS_SERVICE } from './nats.constants';
import {
  AppException,
  AppErrorCode,
  UpstreamTimeoutException,
  UpstreamUnavailableException,
  ValidationErrorItem,
} from '../common/exceptions';
import type {
  EmployeeDto,
  ShiftDto,
  SiteDto,
  VerifiedActor,
} from './dto/nats-contracts';

// Error body that core's NatsErrorFilter sends back; the Nest client rejects with it as is.
interface RemoteErrorBody {
  status: number;
  code: AppErrorCode;
  message: string;
  errors?: ValidationErrorItem[];
}

function isRemoteErrorBody(value: unknown): value is RemoteErrorBody {
  if (!value || typeof value !== 'object') return false;
  const body = value as Partial<RemoteErrorBody>;
  return (
    typeof body.status === 'number' &&
    body.status >= 400 &&
    typeof body.code === 'string' &&
    typeof body.message === 'string'
  );
}

function toAppException(body: RemoteErrorBody): AppException {
  return new AppException(body.status, body.code, body.message, body.errors);
}

@Injectable()
export class NatsClientService {
  private readonly logger = new Logger(NatsClientService.name);

  constructor(@Inject(NATS_SERVICE) private readonly client: ClientProxy) {}

  async request<TReq, TRes>(
    subject: string,
    data: TReq,
    timeoutMs?: number,
  ): Promise<TRes> {
    try {
      const response = await firstValueFrom(
        this.client
          .send<TRes, TReq>(subject, data)
          .pipe(timeout(timeoutMs ?? envs.natsTimeoutMs)),
      );

      // Defensive: a responder that returns an error body as a normal reply.
      if (isRemoteErrorBody(response)) {
        throw toAppException(response);
      }

      return response;
    } catch (error: unknown) {
      if (error instanceof AppException) {
        throw error;
      }
      if (isRemoteErrorBody(error)) {
        throw toAppException(error);
      }
      if (error instanceof TimeoutError) {
        throw new UpstreamTimeoutException(subject);
      }

      const err = error as { code?: string; name?: string; message?: string };
      const code = err?.code || err?.name;
      // With no responder the Nest client gets an empty reply (EmptyResponseException).
      if (
        code === 'NO_RESPONDERS' ||
        code === 'CONNECTION_REFUSED' ||
        code === 'EmptyResponseException' ||
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
