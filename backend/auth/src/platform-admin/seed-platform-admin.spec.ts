import { verifyPassword } from '../common/crypto';
import { SeedError, seedPlatformAdmin } from './seed-platform-admin';
import type { SeedPlatformAdminDeps, SeedPrompt } from './seed-platform-admin';

// The generated client is ESM-only; only its class shape is needed here.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const PASSWORD = 'correct horse battery';
const EMAIL = 'root@acme.test';

interface CreateArgs {
  data: {
    email: string;
    passwordHash: string;
    role: string;
    tenantId: string | null;
    siteIds: string[];
  };
}

function setup(
  options: { existingEmail?: string; createError?: unknown } = {},
) {
  const create = jest.fn((args: CreateArgs) => {
    if (options.createError) return Promise.reject(options.createError);
    return Promise.resolve({ id: 'new-id', email: args.data.email });
  });
  const findUnique = jest.fn((args: { where: { email: string } }) =>
    Promise.resolve(
      args.where.email === options.existingEmail ? { id: 'existing-id' } : null,
    ),
  );
  const prisma = { user: { findUnique, create } };

  const run = (answers: { email: string; hidden: string[] }) => {
    const hidden = [...answers.hidden];
    const ask = jest.fn(() => Promise.resolve(answers.email));
    const askHidden = jest.fn(() => Promise.resolve(hidden.shift() ?? ''));
    const prompt: SeedPrompt = { ask, askHidden };
    const deps = { prisma, prompt } as unknown as SeedPlatformAdminDeps;
    return { ask, askHidden, result: seedPlatformAdmin(deps) };
  };

  return { create, findUnique, run };
}

async function refusal(promise: Promise<unknown>): Promise<SeedError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SeedError);
    return error as SeedError;
  }
  throw new Error('Expected the seed to refuse');
}

describe('seedPlatformAdmin', () => {
  it('creates a PLATFORM_ADMIN with no tenant, no sites and a hashed password', async () => {
    const { create, run } = setup();

    const { result } = run({ email: EMAIL, hidden: [PASSWORD, PASSWORD] });

    await expect(result).resolves.toEqual({ id: 'new-id', email: EMAIL });
    expect(create).toHaveBeenCalledTimes(1);
    const { data } = create.mock.calls[0][0];
    expect(data.role).toBe('PLATFORM_ADMIN');
    expect(data.tenantId).toBeNull();
    expect(data.siteIds).toEqual([]);
    expect(data.passwordHash).not.toContain(PASSWORD);
    await expect(verifyPassword(data.passwordHash, PASSWORD)).resolves.toBe(
      true,
    );
  });

  it('normalizes the email (trimmed and lowercased) before checking and storing it', async () => {
    const { create, findUnique, run } = setup();

    const { result } = run({
      email: '  Root@Acme.TEST ',
      hidden: [PASSWORD, PASSWORD],
    });

    await result;
    expect(findUnique.mock.calls[0][0].where.email).toBe(EMAIL);
    expect(create.mock.calls[0][0].data.email).toBe(EMAIL);
  });

  it('asks for the password only through the hidden prompt', async () => {
    const { run } = setup();

    const { ask, askHidden, result } = run({
      email: EMAIL,
      hidden: [PASSWORD, PASSWORD],
    });

    await result;
    expect(askHidden).toHaveBeenCalledTimes(2);
    expect(ask).toHaveBeenCalledTimes(1);
  });

  it('refuses when the email already exists and writes nothing', async () => {
    const { create, run } = setup({ existingEmail: EMAIL });

    const { askHidden, result } = run({
      email: 'ROOT@acme.test',
      hidden: [PASSWORD, PASSWORD],
    });

    const error = await refusal(result);
    expect(error.message).toContain('already exists');
    expect(create).not.toHaveBeenCalled();
    expect(askHidden).not.toHaveBeenCalled();
  });

  it('refuses when the insert loses a race on the unique email', async () => {
    const { run } = setup({ createError: { code: 'P2002' } });

    const { result } = run({ email: EMAIL, hidden: [PASSWORD, PASSWORD] });

    expect((await refusal(result)).message).toContain('already exists');
  });

  it.each(['', 'not-an-email', 'a@b', `${'a'.repeat(250)}@acme.test`])(
    'rejects the invalid email %j and writes nothing',
    async (email) => {
      const { create, findUnique, run } = setup();

      const { result } = run({ email, hidden: [PASSWORD, PASSWORD] });

      expect((await refusal(result)).message).toContain('Invalid email');
      expect(findUnique).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'short', 'x'.repeat(129)])(
    'rejects the invalid password of length %# and writes nothing',
    async (password) => {
      const { create, run } = setup();

      const { result } = run({ email: EMAIL, hidden: [password, password] });

      expect((await refusal(result)).message).toContain('Invalid password');
      expect(create).not.toHaveBeenCalled();
    },
  );

  it('rejects a mismatched confirmation and writes nothing', async () => {
    const { create, run } = setup();

    const { result } = run({
      email: EMAIL,
      hidden: [PASSWORD, `${PASSWORD}!`],
    });

    expect((await refusal(result)).message).toContain('do not match');
    expect(create).not.toHaveBeenCalled();
  });

  it('never puts the password in a refusal message', async () => {
    const { run } = setup();

    const { result } = run({
      email: EMAIL,
      hidden: [PASSWORD, 'other password'],
    });

    expect((await refusal(result)).message).not.toContain(PASSWORD);
  });
});
