import { GeofenceService } from './geofence.service';
import { SiteCacheService } from './site-cache.service';
import {
  InvalidQrException,
  ValidationException,
} from '../common/exceptions';
import type { SiteDto } from '../nats/dto/nats-contracts';

describe('GeofenceService', () => {
  let service: GeofenceService;
  let mockSiteCache: { getSite: jest.Mock };

  const mockSite: SiteDto = {
    id: 'site-1',
    tenantId: 'tenant-1',
    name: 'Sede Central',
    latitude: -34.6037,
    longitude: -58.3816,
    radiusMeters: 100,
    qrCode: 'QR_SEDE_CENTRAL_SECURE_TOKEN',
  };

  beforeEach(() => {
    mockSiteCache = {
      getSite: jest.fn().mockResolvedValue(mockSite),
    };
    service = new GeofenceService(mockSiteCache as unknown as SiteCacheService);
  });

  it('throws ValidationException when neither GPS nor QR is provided', async () => {
    await expect(
      service.checkLocation('tenant-1', 'site-1', {}),
    ).rejects.toThrow(ValidationException);
  });

  it('throws InvalidQrException when QR does not match site', async () => {
    await expect(
      service.checkLocation('tenant-1', 'site-1', {
        qrCode: 'WRONG_QR_VALUE',
      }),
    ).rejects.toThrow(InvalidQrException);
  });

  it('marks location valid and within geofence when QR code matches site', async () => {
    const result = await service.checkLocation('tenant-1', 'site-1', {
      qrCode: 'QR_SEDE_CENTRAL_SECURE_TOKEN',
    });

    expect(result.isValid).toBe(true);
    expect(result.outOfGeofence).toBe(false);
  });

  it('marks location valid and within geofence when GPS is inside radius', async () => {
    const result = await service.checkLocation('tenant-1', 'site-1', {
      latitude: -34.60375, // ~6 meters away
      longitude: -58.38165,
    });

    expect(result.isValid).toBe(true);
    expect(result.outOfGeofence).toBe(false);
    expect(result.distanceMeters).toBeLessThan(100);
  });

  it('accepts location with outOfGeofence=true when GPS is outside radius and no QR is provided', async () => {
    const result = await service.checkLocation('tenant-1', 'site-1', {
      latitude: -34.6083, // Plaza de Mayo (~1100m away)
      longitude: -58.3712,
    });

    // Never rejects: accepted with flag
    expect(result.isValid).toBe(true);
    expect(result.outOfGeofence).toBe(true);
    expect(result.distanceMeters).toBeGreaterThan(1000);
  });

  it('marks valid and inside geofence when valid QR is scanned even if GPS was outside radius', async () => {
    const result = await service.checkLocation('tenant-1', 'site-1', {
      latitude: -34.6083,
      longitude: -58.3712,
      qrCode: 'QR_SEDE_CENTRAL_SECURE_TOKEN',
    });

    expect(result.isValid).toBe(true);
    expect(result.outOfGeofence).toBe(false);
    expect(result.distanceMeters).toBeGreaterThan(1000);
  });
});
