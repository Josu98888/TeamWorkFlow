import { Injectable, Logger } from '@nestjs/common';
import { NatsClientService } from '../nats/nats-client.service';
import type { SiteDto } from '../nats/dto/nats-contracts';

interface CachedSite {
  site: SiteDto;
  expiresAt: number;
}

const DEFAULT_SITE_TTL_MS = 5 * 60 * 1000; // 5 minutes

@Injectable()
export class SiteCacheService {
  private readonly logger = new Logger(SiteCacheService.name);
  private readonly cache = new Map<string, CachedSite>();

  constructor(private readonly natsClient: NatsClientService) {}

  async getSite(tenantId: string, siteId: string, ttlMs = DEFAULT_SITE_TTL_MS): Promise<SiteDto> {
    const key = `${tenantId}:${siteId}`;
    const now = Date.now();
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > now) {
      return cached.site;
    }

    const site = await this.natsClient.getSite(tenantId, siteId);
    this.cache.set(key, {
      site,
      expiresAt: now + ttlMs,
    });

    return site;
  }

  invalidateSite(siteId: string): void {
    for (const [key, cached] of this.cache.entries()) {
      if (cached.site.id === siteId || key.endsWith(`:${siteId}`)) {
        this.cache.delete(key);
        this.logger.debug(`Invalidated cache for site ${siteId}`);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }
}
