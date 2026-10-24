import { generateOpaqueToken, hashToken, safeEqual } from './token';

// Covers: S3.1
describe('token', () => {
  describe('generateOpaqueToken', () => {
    it('returns 32 random bytes as base64url', () => {
      const token = generateOpaqueToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('returns a different token every call', () => {
      expect(generateOpaqueToken()).not.toBe(generateOpaqueToken());
    });
  });

  describe('hashToken', () => {
    it('returns the SHA-256 hex digest', () => {
      // SHA-256 of "abc" (FIPS 180-2 test vector).
      expect(hashToken('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      );
    });

    it('hashes the same token to the same value', () => {
      const token = generateOpaqueToken();

      expect(hashToken(token)).toBe(hashToken(token));
    });

    it('never returns the raw token', () => {
      const token = generateOpaqueToken();

      expect(hashToken(token)).not.toContain(token);
    });
  });

  describe('safeEqual', () => {
    it('is true for equal strings', () => {
      const hash = hashToken('token');

      expect(safeEqual(hash, hashToken('token'))).toBe(true);
    });

    it('is false for different strings of the same length', () => {
      expect(safeEqual(hashToken('a'), hashToken('b'))).toBe(false);
    });

    it('is false for strings of different length', () => {
      expect(safeEqual('abc', 'abcd')).toBe(false);
    });
  });
});
