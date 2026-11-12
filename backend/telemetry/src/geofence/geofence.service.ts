import { Injectable } from '@nestjs/common';
import { SiteCacheService } from './site-cache.service';
import { evaluateGeofence } from '../common/geo.utils';
import {
  InvalidQrException,
  ValidationException,
} from '../common/exceptions';
import type { SiteDto } from '../nats/dto/nats-contracts';

export interface LocationCheckInput {
  latitude?: number;
  longitude?: number;
  qrCode?: string;
}

export interface LocationCheckResult {
  isValid: boolean;
  outOfGeofence: boolean;
  distanceMeters?: number;
  site: SiteDto;
}

@Injectable()
export class GeofenceService {
  constructor(private readonly siteCache: SiteCacheService) {}

  async checkLocation(
    tenantId: string,
    siteId: string,
    input: LocationCheckInput,
  ): Promise<LocationCheckResult> {
    const hasCoordinates =
      typeof input.latitude === 'number' && typeof input.longitude === 'number';
    const hasQr = typeof input.qrCode === 'string' && input.qrCode.trim().length > 0;

    // Rule: The app must send one of the two (GPS or QR)
    if (!hasCoordinates && !hasQr) {
      throw new ValidationException([
        {
          field: 'location',
          constraints: ['At least one of GPS coordinates or QR code is required'],
        },
      ]);
    }

    const site = await this.siteCache.getSite(tenantId, siteId);

    // Rule: Wrong QR code is rejected as invalid_qr (422)
    if (hasQr) {
      if (!site.qrCode || site.qrCode !== input.qrCode) {
        throw new InvalidQrException();
      }
    }

    // Evaluate GPS if coordinates were provided
    let distanceMeters: number | undefined;
    let isInsideRadius = false;

    if (hasCoordinates) {
      const evaluation = evaluateGeofence(
        site.latitude,
        site.longitude,
        site.radiusMeters,
        input.latitude as number,
        input.longitude as number,
      );
      distanceMeters = evaluation.distanceMeters;
      isInsideRadius = evaluation.isInside;
    }

    // Rule: Valid QR makes it valid, even if GPS failed or is outside radius
    if (hasQr) {
      return {
        isValid: true,
        outOfGeofence: false,
        distanceMeters,
        site,
      };
    }

    // GPS-only evaluation
    if (isInsideRadius) {
      return {
        isValid: true,
        outOfGeofence: false,
        distanceMeters,
        site,
      };
    }

    // Rule: GPS outside radius and no valid QR -> ACCEPTED, flagged outOfGeofence = true
    return {
      isValid: true,
      outOfGeofence: true,
      distanceMeters,
      site,
    };
  }
}
