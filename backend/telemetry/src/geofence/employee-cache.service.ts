import { Injectable, Logger } from '@nestjs/common';
import { NatsClientService } from '../nats/nats-client.service';
import type { EmployeeDto } from '../nats/dto/nats-contracts';

interface CachedEmployee {
  employee: EmployeeDto;
  expiresAt: number;
}

const DEFAULT_EMPLOYEE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class EmployeeCacheService {
  private readonly logger = new Logger(EmployeeCacheService.name);
  private readonly cache = new Map<string, CachedEmployee>();

  constructor(private readonly natsClient: NatsClientService) {}

  async getEmployee(tenantId: string, userId: string, ttlMs = DEFAULT_EMPLOYEE_TTL_MS): Promise<EmployeeDto> {
    const key = `${tenantId}:${userId}`;
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.employee;
    }

    const employee = await this.natsClient.getEmployee(tenantId, userId);
    this.cache.set(key, {
      employee,
      expiresAt: now + ttlMs,
    });

    return employee;
  }

  invalidateEmployee(tenantId: string, userId: string): void {
    const key = `${tenantId}:${userId}`;
    this.cache.delete(key);
    this.logger.debug(`Invalidated cache for employee ${userId}`);
  }

  clear(): void {
    this.cache.clear();
  }
}
