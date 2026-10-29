// Earth radius in meters (WGS84 spherical approximation)
const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Calculates the great-circle distance between two geographic coordinates
 * in meters using the Haversine formula.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);

  const radLat1 = toRadians(lat1);
  const radLat2 = toRadians(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(EARTH_RADIUS_METERS * c * 100) / 100;
}

export interface GeofenceEvaluation {
  isInside: boolean;
  distanceMeters: number;
  radiusMeters: number;
}

/**
 * Evaluates whether a worker coordinate is within a site's circular geofence.
 * Never rejects: returns calculated distance and whether it is within the allowed radius.
 */
export function evaluateGeofence(
  siteLatitude: number,
  siteLongitude: number,
  radiusMeters: number,
  workerLatitude: number,
  workerLongitude: number,
): GeofenceEvaluation {
  const distanceMeters = haversineDistanceMeters(
    siteLatitude,
    siteLongitude,
    workerLatitude,
    workerLongitude,
  );

  return {
    isInside: distanceMeters <= radiusMeters,
    distanceMeters,
    radiusMeters,
  };
}
