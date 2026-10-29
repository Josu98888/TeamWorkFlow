import {
  haversineDistanceMeters,
  evaluateGeofence,
} from './geo.utils';

describe('geo.utils', () => {
  // Obelisco Buenos Aires: -34.6037, -58.3816
  const obeliscoLat = -34.6037;
  const obeliscoLon = -58.3816;

  // Plaza de Mayo Buenos Aires (~1100m away): -34.6083, -58.3712
  const plazaDeMayoLat = -34.6083;
  const plazaDeMayoLon = -58.3712;

  it('calculates 0 meters for identical coordinates', () => {
    const dist = haversineDistanceMeters(
      obeliscoLat,
      obeliscoLon,
      obeliscoLat,
      obeliscoLon,
    );
    expect(dist).toBe(0);
  });

  it('calculates expected real-world distance between Obelisco and Plaza de Mayo (~1100m)', () => {
    const dist = haversineDistanceMeters(
      obeliscoLat,
      obeliscoLon,
      plazaDeMayoLat,
      plazaDeMayoLon,
    );
    // Real distance is ~1090-1120 meters
    expect(dist).toBeGreaterThan(1000);
    expect(dist).toBeLessThan(1200);
  });

  it('evaluates inside geofence when worker is within radius', () => {
    // 50 meters offset
    const workerLat = -34.6038;
    const workerLon = -58.3817;

    const evaluation = evaluateGeofence(
      obeliscoLat,
      obeliscoLon,
      100, // 100m radius
      workerLat,
      workerLon,
    );

    expect(evaluation.isInside).toBe(true);
    expect(evaluation.distanceMeters).toBeLessThan(100);
    expect(evaluation.radiusMeters).toBe(100);
  });

  it('evaluates outside geofence when worker exceeds radius', () => {
    const evaluation = evaluateGeofence(
      obeliscoLat,
      obeliscoLon,
      200, // 200m radius
      plazaDeMayoLat, // ~1100m away
      plazaDeMayoLon,
    );

    expect(evaluation.isInside).toBe(false);
    expect(evaluation.distanceMeters).toBeGreaterThan(1000);
  });
});
