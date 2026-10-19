import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { createTerminalPrompt } from './terminal-prompt';
import { SeedError, seedPlatformAdmin } from './seed-platform-admin';

// Entrypoint of `pnpm seed:platform-admin`. Email and password are typed by the
// operator at run time: there are no arguments or variables for them. Only
// DATABASE_URL is read from the environment (same adapter setup as
// PrismaService, which is not used because it needs every service variable).
async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new SeedError('DATABASE_URL is not set.');

  // Refuses first when there is no TTY, before anything touches the database.
  const prompt = createTerminalPrompt();
  const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'auth';
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }, { schema }),
  });

  try {
    const admin = await seedPlatformAdmin({ prisma, prompt });
    console.log(`Platform admin created: ${admin.email} (${admin.id})`);
  } finally {
    prompt.close();
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof SeedError || error instanceof Error
      ? error.message
      : 'Unexpected error.',
  );
  process.exitCode = 1;
});
