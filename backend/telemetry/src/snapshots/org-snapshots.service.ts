import { Injectable, Logger } from '@nestjs/common';
import { envs } from '../config';
import { NatsClientService } from '../nats/nats-client.service';
import { AttendancePrismaService } from '../prisma/attendance-prisma.service';
import type {
  EmployeeSnapshot,
  PostSnapshot,
  Prisma,
  SiteSnapshot,
} from '../prisma/generated/client';

const DEFAULT_TZ = 'America/Argentina/Buenos_Aires';

@Injectable()
export class OrgSnapshotsService {
  private readonly logger = new Logger(OrgSnapshotsService.name);

  constructor(
    private readonly prisma: AttendancePrismaService,
    private readonly natsClient: NatsClientService,
  ) {}

  async upsertSite(
    input: {
      siteId: string;
      tenantId: string;
      name?: string;
      timezone?: string;
      isActive?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<SiteSnapshot> {
    const client = tx ?? this.prisma;
    const defaultTz = envs.defaultReportTz ?? DEFAULT_TZ;
    return client.siteSnapshot.upsert({
      where: { siteId: input.siteId },
      update: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      create: {
        siteId: input.siteId,
        tenantId: input.tenantId,
        name: input.name ?? 'Sede',
        timezone: input.timezone ?? defaultTz,
        isActive: input.isActive ?? true,
      },
    });
  }

  async upsertPost(
    input: {
      postId: string;
      tenantId: string;
      siteId: string;
      name: string;
      isActive?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<PostSnapshot> {
    const client = tx ?? this.prisma;
    return client.postSnapshot.upsert({
      where: { postId: input.postId },
      update: {
        siteId: input.siteId,
        name: input.name,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      create: {
        postId: input.postId,
        tenantId: input.tenantId,
        siteId: input.siteId,
        name: input.name,
        isActive: input.isActive ?? true,
      },
    });
  }

  async upsertEmployee(
    input: {
      employeeId: string;
      tenantId: string;
      userId?: string | null;
      firstName: string;
      lastName: string;
      employeeNumber?: string | null;
      siteIds?: string[];
      isActive?: boolean;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<EmployeeSnapshot> {
    const client = tx ?? this.prisma;
    return client.employeeSnapshot.upsert({
      where: { employeeId: input.employeeId },
      update: {
        ...(input.userId !== undefined ? { userId: input.userId } : {}),
        firstName: input.firstName,
        lastName: input.lastName,
        ...(input.employeeNumber !== undefined
          ? { employeeNumber: input.employeeNumber }
          : {}),
        ...(input.siteIds !== undefined ? { siteIds: input.siteIds } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      create: {
        employeeId: input.employeeId,
        tenantId: input.tenantId,
        userId: input.userId ?? null,
        firstName: input.firstName,
        lastName: input.lastName,
        employeeNumber: input.employeeNumber ?? null,
        siteIds: input.siteIds ?? [],
        isActive: input.isActive ?? true,
      },
    });
  }

  async ensureTenantCatalogSynced(tenantId: string): Promise<void> {
    const [siteCount, postCount, empCount] = await Promise.all([
      this.prisma.siteSnapshot.count({ where: { tenantId } }),
      this.prisma.postSnapshot.count({ where: { tenantId } }),
      this.prisma.employeeSnapshot.count({ where: { tenantId } }),
    ]);

    if (siteCount === 0) {
      try {
        const sites = await this.natsClient.listSites(tenantId);
        for (const site of sites ?? []) {
          if (site.tenantId === tenantId) {
            await this.upsertSite({
              siteId: site.id,
              tenantId,
              name: site.name,
              timezone: site.timezone,
              isActive: site.isActive,
            });
          }
        }
      } catch {
        this.logger.debug(`Catalog sync skipped for sites of tenant ${tenantId}`);
      }
    }

    if (postCount === 0) {
      try {
        const posts = await this.natsClient.listPosts(tenantId);
        for (const post of posts ?? []) {
          if (post.tenantId === tenantId) {
            await this.upsertPost({
              postId: post.id,
              tenantId,
              siteId: post.siteId,
              name: post.name,
              isActive: post.isActive,
            });
          }
        }
      } catch {
        this.logger.debug(`Catalog sync skipped for posts of tenant ${tenantId}`);
      }
    }

    if (empCount === 0) {
      try {
        const employees = await this.natsClient.listEmployees(tenantId);
        for (const emp of employees ?? []) {
          if (emp.tenantId === tenantId) {
            await this.upsertEmployee({
              employeeId: emp.id,
              tenantId,
              userId: emp.userId,
              firstName: emp.firstName,
              lastName: emp.lastName,
              employeeNumber: emp.employeeNumber,
              siteIds: emp.siteIds ?? [],
              isActive: emp.isActive,
            });
          }
        }
      } catch {
        this.logger.debug(
          `Catalog sync skipped for employees of tenant ${tenantId}`,
        );
      }
    }
  }

  async getSiteTimezone(tenantId: string, siteId: string): Promise<string> {
    const fallback = envs.defaultReportTz ?? DEFAULT_TZ;
    const local = await this.prisma.siteSnapshot.findFirst({
      where: { tenantId, siteId },
    });
    if (local?.timezone) {
      return local.timezone;
    }

    try {
      const remote = await this.natsClient.getSite(tenantId, siteId);
      if (remote && remote.tenantId === tenantId) {
        const tz = remote.timezone ?? fallback;
        await this.upsertSite({
          siteId: remote.id,
          tenantId,
          name: remote.name,
          timezone: tz,
          isActive: remote.isActive ?? true,
        });
        return tz;
      }
    } catch {
      // Fallback to default report timezone when NATS or site snapshot is unavailable.
    }

    return fallback;
  }
}
