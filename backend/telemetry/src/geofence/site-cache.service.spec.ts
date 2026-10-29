import { SiteCacheService } from './site-cache.service';
import { NatsClientService } from '../nats/nats-client.service';
import type { SiteDto } from '../nats/dto/nats-contracts';

describe('SiteCacheService', () => {
  let service: SiteCacheService;
  let mockNatsClient: { getSite: jest.Mock };

  const mockSite: SiteDto = {
    id: 'site-1',
    tenantId: 'tenant-1',
    name: 'Obra Norte',
    latitude: -34.6037,
    longitude: -58.3816,
    radiusMeters: 150,
  };

  beforeEach(() => {
    mockNatsClient = {
      getSite: jest.fn().mockResolvedValue(mockSite),
    };
    service = new SiteCacheService(mockNatsClient as unknown as NatsClientService);
  });

  it('fetches from NATS on cache miss and caches response', async () => {
    const site1 = await service.getSite('tenant-1', 'site-1');
    const site2 = await service.getSite('tenant-1', 'site-1');

    expect(site1).toEqual(mockSite);
    expect(site2).toEqual(mockSite);
    expect(mockNatsClient.getSite).toHaveBeenCalledTimes(1);
  });

  it('re-fetches from NATS after cache invalidation', async () => {
    await service.getSite('tenant-1', 'site-1');
    service.invalidateSite('site-1');
    await service.getSite('tenant-1', 'site-1');

    expect(mockNatsClient.getSite).toHaveBeenCalledTimes(2);
  });
});
