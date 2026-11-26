import { Injectable } from '@nestjs/common';
import {
  EmployeeNotFoundException,
  PostNotFoundException,
} from '../common/exceptions';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import { Prisma, type PayRateType } from '../prisma/generated/client';
import { OrgSnapshotsService } from '../snapshots/org-snapshots.service';
import type {
  UpsertEmployeeCompensationDto,
  UpsertPostOvertimeRateDto,
} from './dto/compensation.dto';

export interface EmployeeCompensationView {
  employeeId: string;
  firstName: string;
  lastName: string;
  employeeNumber: string | null;
  isActive: boolean;
  payType: PayRateType | null;
  baseRate: string | null;
  currency: string;
  updatedAt: string | null;
}

export interface PostOvertimeRateView {
  postId: string;
  siteId: string;
  siteName: string;
  postName: string;
  isActive: boolean;
  overtimeHourlyRate: string | null;
  currency: string;
  updatedAt: string | null;
}

@Injectable()
export class CompensationService {
  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly snapshots: OrgSnapshotsService,
  ) {}

  async listEmployeeCompensations(
    actor: VerifiedActor,
  ): Promise<{ items: EmployeeCompensationView[]; total: number }> {
    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);

    const [employees, rates] = await Promise.all([
      this.prisma.employeeSnapshot.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
      this.prisma.employeeCompensation.findMany({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    const rateByEmp = new Map(rates.map((r) => [r.employeeId, r]));
    const items: EmployeeCompensationView[] = employees.map((emp) => {
      const rate = rateByEmp.get(emp.employeeId);
      return {
        employeeId: emp.employeeId,
        firstName: emp.firstName,
        lastName: emp.lastName,
        employeeNumber: emp.employeeNumber,
        isActive: emp.isActive,
        payType: rate?.payType ?? null,
        baseRate: rate ? rate.baseRate.toFixed(2) : null,
        currency: rate?.currency ?? 'ARS',
        updatedAt: rate ? rate.updatedAt.toISOString() : null,
      };
    });

    return { items, total: items.length };
  }

  async upsertEmployeeCompensation(
    actor: VerifiedActor,
    employeeId: string,
    dto: UpsertEmployeeCompensationDto,
  ): Promise<EmployeeCompensationView> {
    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);

    const emp = await this.prisma.employeeSnapshot.findFirst({
      where: { tenantId: actor.tenantId, employeeId },
    });
    if (!emp) {
      throw new EmployeeNotFoundException();
    }

    const payType: PayRateType =
      dto.payType.toUpperCase() === 'PER_SHIFT' ? 'PER_SHIFT' : 'HOURLY';
    const baseRate = new Prisma.Decimal(dto.baseRate).toDecimalPlaces(
      2,
      Prisma.Decimal.ROUND_HALF_UP,
    );

    const existing = await this.prisma.employeeCompensation.findUnique({
      where: {
        tenantId_employeeId: {
          tenantId: actor.tenantId,
          employeeId,
        },
      },
    });

    const saved = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.employeeCompensation.upsert({
        where: {
          tenantId_employeeId: {
            tenantId: actor.tenantId,
            employeeId,
          },
        },
        update: {
          payType,
          baseRate,
          updatedByUserId: actor.userId,
        },
        create: {
          tenantId: actor.tenantId,
          employeeId,
          payType,
          baseRate,
          currency: 'ARS',
          updatedByUserId: actor.userId,
        },
      });

      await tx.compensationChangeLog.create({
        data: {
          tenantId: actor.tenantId,
          targetType: 'EMPLOYEE',
          targetId: employeeId,
          before: existing
            ? {
                payType: existing.payType,
                baseRate: existing.baseRate.toFixed(2),
              }
            : Prisma.JsonNull,
          after: {
            payType: upserted.payType,
            baseRate: upserted.baseRate.toFixed(2),
          },
          changedByUserId: actor.userId,
          reason: dto.reason ?? null,
        },
      });

      return upserted;
    });

    return {
      employeeId: emp.employeeId,
      firstName: emp.firstName,
      lastName: emp.lastName,
      employeeNumber: emp.employeeNumber,
      isActive: emp.isActive,
      payType: saved.payType,
      baseRate: saved.baseRate.toFixed(2),
      currency: saved.currency,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async listPostOvertimeRates(
    actor: VerifiedActor,
  ): Promise<{ items: PostOvertimeRateView[]; total: number }> {
    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);

    const [sites, posts, rates] = await Promise.all([
      this.prisma.siteSnapshot.findMany({
        where: { tenantId: actor.tenantId },
      }),
      this.prisma.postSnapshot.findMany({
        where: { tenantId: actor.tenantId },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.postOvertimeRate.findMany({
        where: { tenantId: actor.tenantId },
      }),
    ]);

    const siteById = new Map(sites.map((s) => [s.siteId, s]));
    const rateByPost = new Map(rates.map((r) => [r.postId, r]));

    const items: PostOvertimeRateView[] = posts.map((post) => {
      const rate = rateByPost.get(post.postId);
      const site = siteById.get(post.siteId);
      return {
        postId: post.postId,
        siteId: post.siteId,
        siteName: site?.name ?? 'Sede',
        postName: post.name,
        isActive: post.isActive,
        overtimeHourlyRate: rate ? rate.overtimeHourlyRate.toFixed(2) : null,
        currency: rate?.currency ?? 'ARS',
        updatedAt: rate ? rate.updatedAt.toISOString() : null,
      };
    });

    return { items, total: items.length };
  }

  async upsertPostOvertimeRate(
    actor: VerifiedActor,
    postId: string,
    dto: UpsertPostOvertimeRateDto,
  ): Promise<PostOvertimeRateView> {
    await this.snapshots.ensureTenantCatalogSynced(actor.tenantId);

    const post = await this.prisma.postSnapshot.findFirst({
      where: { tenantId: actor.tenantId, postId },
    });
    if (!post) {
      throw new PostNotFoundException();
    }

    const site = await this.prisma.siteSnapshot.findFirst({
      where: { tenantId: actor.tenantId, siteId: post.siteId },
    });

    const overtimeHourlyRate = new Prisma.Decimal(
      dto.overtimeHourlyRate,
    ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const existing = await this.prisma.postOvertimeRate.findUnique({
      where: {
        tenantId_postId: {
          tenantId: actor.tenantId,
          postId,
        },
      },
    });

    const saved = await this.prisma.$transaction(async (tx) => {
      const upserted = await tx.postOvertimeRate.upsert({
        where: {
          tenantId_postId: {
            tenantId: actor.tenantId,
            postId,
          },
        },
        update: {
          siteId: post.siteId,
          overtimeHourlyRate,
          updatedByUserId: actor.userId,
        },
        create: {
          tenantId: actor.tenantId,
          postId,
          siteId: post.siteId,
          overtimeHourlyRate,
          currency: 'ARS',
          updatedByUserId: actor.userId,
        },
      });

      await tx.compensationChangeLog.create({
        data: {
          tenantId: actor.tenantId,
          targetType: 'POST',
          targetId: postId,
          before: existing
            ? {
                overtimeHourlyRate: existing.overtimeHourlyRate.toFixed(2),
              }
            : Prisma.JsonNull,
          after: {
            overtimeHourlyRate: upserted.overtimeHourlyRate.toFixed(2),
          },
          changedByUserId: actor.userId,
          reason: dto.reason ?? null,
        },
      });

      return upserted;
    });

    return {
      postId: post.postId,
      siteId: post.siteId,
      siteName: site?.name ?? 'Sede',
      postName: post.name,
      isActive: post.isActive,
      overtimeHourlyRate: saved.overtimeHourlyRate.toFixed(2),
      currency: saved.currency,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async listHistory(actor: VerifiedActor) {
    const items = await this.prisma.compensationChangeLog.findMany({
      where: { tenantId: actor.tenantId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items, total: items.length };
  }
}
