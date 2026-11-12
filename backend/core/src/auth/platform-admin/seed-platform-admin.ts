import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { hashPassword } from '../crypto';
import type { PrismaClient } from '../prisma/generated/client';
import {
  PlatformAdminSeedEmail,
  PlatformAdminSeedPassword,
} from './platform-admin-seed.dto';

// Reads from the operator at run time. `askHidden` must not echo the answer.
export interface SeedPrompt {
  ask(question: string): Promise<string>;
  askHidden(question: string): Promise<string>;
}

export interface SeedPlatformAdminDeps {
  prisma: Pick<PrismaClient, 'user'>;
  prompt: SeedPrompt;
}

// A refusal the operator can read as is. Messages never contain the password.
export class SeedError extends Error {}

const UNIQUE_VIOLATION = 'P2002';

async function readEmail(prompt: SeedPrompt): Promise<string> {
  const raw = await prompt.ask('Platform admin email: ');
  const dto = plainToInstance(PlatformAdminSeedEmail, { email: raw });
  if ((await validate(dto)).length > 0) {
    throw new SeedError(
      'Invalid email (valid address, at most 254 characters).',
    );
  }
  return dto.email;
}

async function readPassword(prompt: SeedPrompt): Promise<string> {
  const password = await prompt.askHidden('Password: ');
  const dto = plainToInstance(PlatformAdminSeedPassword, { password });
  if ((await validate(dto)).length > 0) {
    throw new SeedError('Invalid password (8 to 128 characters).');
  }
  const confirmation = await prompt.askHidden('Repeat the password: ');
  if (confirmation !== password) {
    throw new SeedError('The passwords do not match.');
  }
  return password;
}

// Creates the `platform_admin` (no tenant, no sites). It is the only way one
// is created: no request path can (AGENTS § Roles). Refuses, writing nothing,
// when the email already exists in any tenant.
export async function seedPlatformAdmin({
  prisma,
  prompt,
}: SeedPlatformAdminDeps): Promise<{ id: string; email: string }> {
  const email = await readEmail(prompt);
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) {
    throw new SeedError(`A user with the email ${email} already exists.`);
  }

  const password = await readPassword(prompt);
  const passwordHash = await hashPassword(password);

  try {
    return await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'PLATFORM_ADMIN',
        tenantId: null,
        siteIds: [],
      },
      select: { id: true, email: true },
    });
  } catch (error) {
    // Lost a race against another writer between the check and the insert.
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      throw new SeedError(`A user with the email ${email} already exists.`);
    }
    throw error;
  }
}
