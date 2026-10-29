import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { SiteNotFoundException } from '../../common/exceptions/app.exceptions';
import { OrganizationEventsService } from '../events/organization-events.service';
import type { OrganizationActor } from '../organization-actor';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { OrganizationPrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_PAGE_SIZE,
  type CreateSiteBodyDto,
  type PageQueryDto,
  type UpdateSiteBodyDto,
} from './dto/site.dto';
import {
  canAccessSite,
  canReadSites,
  canSeeQrCode,
  requireSiteManager,
  requireTenantActor,
  type TenantActor,
} from './site-policy';

interface SiteRow {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  timezone: string;
  qrCode: string;
  qrRotatedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// `qrCode` is absent for employee actors.
export type SiteView = Omit<SiteRow, 'qrCode'> & { qrCode?: string };

export interface PageResult<T> {
  items: T[];
  total: number;
}

export function pageWindow(query: PageQueryDto) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  return { skip: (page - 1) * pageSize, take: pageSize };
}

// 24 random bytes: opaque, URL-safe and unguessable. Uniqueness is also backed
// by the unique index on `qr_code`.
export function generateQrCode(): string {
  return randomBytes(24).toString('base64url');
}

function definedFields(dto: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(dto).filter(([, value]) => value !== undefined),
  );
}

@Injectable()
export class SitesService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly events: OrganizationEventsService,
  ) {}

  // `organization.site.create` (owner/admin). The tenant comes from the actor.
  async create(
    actor: OrganizationActor,
    dto: CreateSiteBodyDto,
  ): Promise<SiteView> {
    const manager = requireSiteManager(actor);
    const site = await this.prisma.site.create({
      data: {
        tenantId: manager.tenantId,
        name: dto.name,
        address: dto.address,
        latitude: dto.latitude,
        longitude: dto.longitude,
        geofenceRadiusMeters: dto.geofenceRadiusMeters,
        timezone: dto.timezone,
        qrCode: generateQrCode(),
      },
    });
    await this.emitSiteUpdated(site, false);
    return this.toView(manager, site);
  }

  // `organization.site.update` (owner/admin). Deactivation is `isActive: false`.
  async update(
    actor: OrganizationActor,
    siteId: string,
    dto: UpdateSiteBodyDto,
  ): Promise<SiteView> {
    const manager = requireSiteManager(actor);
    const current = await this.findOrThrow(manager, siteId);
    const data = definedFields(dto);
    if (Object.keys(data).length === 0) {
      return this.toView(manager, current);
    }
    const { count } = await this.prisma.site.updateMany({
      where: { id: siteId, tenantId: manager.tenantId },
      data,
    });
    if (count !== 1) {
      throw new SiteNotFoundException();
    }
    const site = await this.findOrThrow(manager, siteId);
    await this.emitSiteUpdated(site, false);
    return this.toView(manager, site);
  }

  // `organization.site.get`. Out of scope or employee: 404.
  async get(actor: OrganizationActor, siteId: string): Promise<SiteView> {
    const reader = requireTenantActor(actor);
    const site = await this.requireAccessibleSite(reader, siteId);
    return this.toView(reader, site);
  }

  // `organization.site.list`. Owner/admin: every site of the tenant;
  // supervisor: only `siteIds`; employee: nothing.
  async list(
    actor: OrganizationActor,
    query: PageQueryDto,
  ): Promise<PageResult<SiteView>> {
    const reader = requireTenantActor(actor);
    if (!canReadSites(reader)) {
      return { items: [], total: 0 };
    }
    const where =
      reader.role === 'supervisor'
        ? { tenantId: reader.tenantId, id: { in: reader.siteIds ?? [] } }
        : { tenantId: reader.tenantId };
    const [rows, total] = await Promise.all([
      this.prisma.site.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.site.count({ where }),
    ]);
    return { items: rows.map((row) => this.toView(reader, row)), total };
  }

  // `organization.site.rotate-qr` (owner/admin): the old value stops being
  // valid immediately.
  async rotateQr(actor: OrganizationActor, siteId: string): Promise<SiteView> {
    const manager = requireSiteManager(actor);
    await this.findOrThrow(manager, siteId);
    const { count } = await this.prisma.site.updateMany({
      where: { id: siteId, tenantId: manager.tenantId },
      data: { qrCode: generateQrCode(), qrRotatedAt: new Date() },
    });
    if (count !== 1) {
      throw new SiteNotFoundException();
    }
    const site = await this.findOrThrow(manager, siteId);
    await this.emitSiteUpdated(site, true);
    return this.toView(manager, site);
  }

  // Shared with the posts service: a site of the actor's tenant that the actor
  // can access, else 404 `site_not_found`.
  async requireAccessibleSite(
    actor: TenantActor,
    siteId: string,
  ): Promise<SiteRow> {
    if (!canAccessSite(actor, siteId)) {
      throw new SiteNotFoundException();
    }
    return this.findOrThrow(actor, siteId);
  }

  // For the shifts sub-module: a site of `tenantId`, no actor scope check (the
  // caller already authorized the access). 404 `site_not_found` otherwise.
  async getForTenant(tenantId: string, siteId: string): Promise<SiteRow> {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenantId },
    });
    if (!site) {
      throw new SiteNotFoundException();
    }
    return site;
  }

  // For the employees sub-module (enabled sites): which of `siteIds` exist in
  // the tenant. Returns only the matching ids; it does not check actor scope.
  async findExistingSiteIds(
    tenantId: string,
    siteIds: string[],
  ): Promise<string[]> {
    if (siteIds.length === 0) return [];
    const rows = await this.prisma.site.findMany({
      where: { tenantId, id: { in: siteIds } },
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  private async findOrThrow(
    actor: TenantActor,
    siteId: string,
  ): Promise<SiteRow> {
    const site = await this.prisma.site.findFirst({
      where: { id: siteId, tenantId: actor.tenantId },
    });
    if (!site) {
      throw new SiteNotFoundException();
    }
    return site;
  }

  private toView(actor: TenantActor, site: SiteRow): SiteView {
    const { qrCode, ...rest } = site;
    return canSeeQrCode(actor) ? { ...rest, qrCode } : rest;
  }

  // After the write: a failed publish is logged by the events service and never
  // rolls the data back. Also emitted on create so consumers can cache the site.
  private emitSiteUpdated(site: SiteRow, qrRotated: boolean) {
    return this.events.publish(site.tenantId, ORGANIZATION_EVENTS.siteUpdated, {
      siteId: site.id,
      tenantId: site.tenantId,
      latitude: site.latitude,
      longitude: site.longitude,
      geofenceRadiusMeters: site.geofenceRadiusMeters,
      qrRotated,
    });
  }
}
