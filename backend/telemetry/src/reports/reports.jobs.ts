import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { getEnv } from '../config/envs';
import { PrismaService } from '../prisma/prisma.service';
import { TenantStateService } from '../tenants/tenant-state.service';
import { formatDateInTz, getPreviousMonthPeriod } from './domain/timezone-range';
import { ReportsService } from './reports.service';

const DAY_MS = 24 * 60 * 60_000;

@Injectable()
export class DailyReportJob {
  private readonly logger = new Logger(DailyReportJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantState: TenantStateService,
    private readonly reportsService: ReportsService,
  ) {}

  @Cron('15 3 * * *')
  async handleCron(): Promise<void> {
    await this.runOnce(new Date());
  }

  async runOnce(now: Date = new Date()): Promise<number> {
    const defaultTz = getEnv().DEFAULT_REPORT_TZ;
    const yesterdayDate = formatDateInTz(
      new Date(now.getTime() - DAY_MS),
      defaultTz,
    );

    const tenants = await this.prisma.shiftSnapshot.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let generated = 0;
    for (const { tenantId } of tenants) {
      if (this.tenantState.isSuspended(tenantId)) continue;
      try {
        await this.reportsService.generateAndSaveDailySnapshot(
          tenantId,
          yesterdayDate,
          now,
        );
        generated++;
      } catch (err) {
        this.logger.warn(
          `Failed to generate daily report for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return generated;
  }
}

@Injectable()
export class MonthlyReportJob {
  private readonly logger = new Logger(MonthlyReportJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantState: TenantStateService,
    private readonly reportsService: ReportsService,
  ) {}

  @Cron('0 7 1 * *')
  async handleCron(): Promise<void> {
    await this.runOnce(new Date());
  }

  async runOnce(now: Date = new Date()): Promise<number> {
    const defaultTz = getEnv().DEFAULT_REPORT_TZ;
    const previousPeriod = getPreviousMonthPeriod(now, defaultTz);

    const tenants = await this.prisma.shiftSnapshot.findMany({
      distinct: ['tenantId'],
      select: { tenantId: true },
    });

    let generated = 0;
    for (const { tenantId } of tenants) {
      if (this.tenantState.isSuspended(tenantId)) continue;
      try {
        await this.reportsService.generateAndSaveMonthlySnapshot(
          tenantId,
          previousPeriod,
          now,
        );
        generated++;
      } catch (err) {
        this.logger.warn(
          `Failed to generate monthly report for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return generated;
  }
}
