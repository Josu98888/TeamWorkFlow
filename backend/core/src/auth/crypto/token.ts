import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const OPAQUE_TOKEN_BYTES = 32;

// Refresh, invitation and password reset tokens: returned once to the
// caller, stored only as `hashToken(token)`.
export function generateOpaqueToken(): string {
  return randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// Both sides are digested first so `timingSafeEqual` always compares
// 32-byte buffers and the time does not depend on the input lengths.
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b)) && a.length === b.length;
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
