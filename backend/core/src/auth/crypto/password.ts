import { argon2id, hash, verify } from 'argon2';

// Library defaults for argon2id (memory, time and parallelism cost).
export function hashPassword(password: string): Promise<string> {
  return hash(password, { type: argon2id });
}

export function verifyPassword(
  passwordHash: string,
  password: string,
): Promise<boolean> {
  return verify(passwordHash, password);
}
