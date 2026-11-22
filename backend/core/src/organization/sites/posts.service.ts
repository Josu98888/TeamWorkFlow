import { Injectable, Optional } from '@nestjs/common';
import { PostNotFoundException } from '../../common/exceptions/app.exceptions';
import { OrganizationEventsService } from '../events/organization-events.service';
import type { OrganizationActor } from '../organization-actor';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { OrganizationPrismaService } from '../prisma/prisma.service';
import type {
  CreatePostBodyDto,
  PageQueryDto,
  UpdatePostBodyDto,
} from './dto/site.dto';
import { requireSiteManager, requireTenantActor } from './site-policy';
import { pageWindow, SitesService, type PageResult } from './sites.service';

export interface PostView {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  requiredSkills: string[];
  minPeople: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PostsService {
  constructor(
    private readonly prisma: OrganizationPrismaService,
    private readonly sites: SitesService,
    @Optional() private readonly events?: OrganizationEventsService,
  ) {}

  // `organization.post.create` (owner/admin).
  async create(
    actor: OrganizationActor,
    siteId: string,
    dto: CreatePostBodyDto,
  ): Promise<PostView> {
    const manager = requireSiteManager(actor);
    await this.sites.requireAccessibleSite(manager, siteId);
    const post = await this.prisma.post.create({
      data: {
        tenantId: manager.tenantId,
        siteId,
        name: dto.name,
        requiredSkills: dto.requiredSkills ?? [],
        minPeople: dto.minPeople ?? 1,
      },
    });
    await this.events?.publish(post.tenantId, ORGANIZATION_EVENTS.postCreated, {
      postId: post.id,
      tenantId: post.tenantId,
      siteId: post.siteId,
      name: post.name,
      isActive: post.isActive,
    });
    return post;
  }

  // `organization.post.update` (owner/admin).
  async update(
    actor: OrganizationActor,
    postId: string,
    dto: UpdatePostBodyDto,
  ): Promise<PostView> {
    const manager = requireSiteManager(actor);
    const where = { id: postId, tenantId: manager.tenantId };
    if (!(await this.prisma.post.findFirst({ where }))) {
      throw new PostNotFoundException();
    }
    const data = Object.fromEntries(
      Object.entries(dto).filter(([, value]) => value !== undefined),
    );
    if (Object.keys(data).length > 0) {
      const { count } = await this.prisma.post.updateMany({ where, data });
      if (count !== 1) {
        throw new PostNotFoundException();
      }
    }
    const post = await this.prisma.post.findFirst({ where });
    if (!post) {
      throw new PostNotFoundException();
    }
    await this.events?.publish(post.tenantId, ORGANIZATION_EVENTS.postUpdated, {
      postId: post.id,
      tenantId: post.tenantId,
      siteId: post.siteId,
      name: post.name,
      isActive: post.isActive,
    });
    return post;
  }

  // `organization.post.list`. A site outside the actor's scope (or any site for
  // an employee) answers 404 `site_not_found`.
  async list(
    actor: OrganizationActor,
    siteId: string,
    query: PageQueryDto,
  ): Promise<PageResult<PostView>> {
    const reader = requireTenantActor(actor);
    await this.sites.requireAccessibleSite(reader, siteId);
    const where = { tenantId: reader.tenantId, siteId };
    const [items, total] = await Promise.all([
      this.prisma.post.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        ...pageWindow(query),
      }),
      this.prisma.post.count({ where }),
    ]);
    return { items, total };
  }

  // For the shifts sub-module: a post of `tenantId`, no actor scope check (the
  // caller already authorized the site). 404 `post_not_found` otherwise.
  async getForTenant(tenantId: string, postId: string): Promise<PostView> {
    const post = await this.prisma.post.findFirst({
      where: { id: postId, tenantId },
    });
    if (!post) {
      throw new PostNotFoundException();
    }
    return post;
  }

  // For the telemetry NATS catalog responder: all posts of `tenantId`.
  async listForTenant(tenantId: string, siteId?: string): Promise<PostView[]> {
    return this.prisma.post.findMany({
      where: { tenantId, ...(siteId ? { siteId } : {}) },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }
}
