import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { verifyPassword } from './crypto';
import { EmailTakenException } from '../common/exceptions/app.exceptions';
import { JetStreamService } from './events/jetstream.service';
import { PrismaService } from './prisma/prisma.service';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed; this avoids building a driver adapter.
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

// Real Argon2 hashing is slow when the whole suite runs in parallel.
jest.setTimeout(30_000);

const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const PAIR = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };

const dto = {
  tenantName: 'Acme Security',
  name: 'Ana Perez',
  email: 'ana@acme.test',
  password: 'correct horse battery',
};

async function waitUntil(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

interface UserCreateArgs {
  data: Record<string, unknown>;
}

// Covers: S3.3
describe('AuthService.register', () => {
  let service: AuthService;
  const tx = {
    tenant: { create: jest.fn() },
    user: { create: jest.fn() },
  };
  const prisma = { $transaction: jest.fn() };
  const tokens = { issueTokenPair: jest.fn() };
  const jetstream = { publish: jest.fn() };
  const calls: string[] = [];

  function userData(): Record<string, unknown> {
    return (tx.user.create.mock.calls[0] as [UserCreateArgs])[0].data;
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    calls.length = 0;
    tx.tenant.create.mockResolvedValue({
      id: TENANT_ID,
      name: 'Acme Security',
    });
    tx.user.create.mockResolvedValue({
      id: USER_ID,
      tenantId: TENANT_ID,
      email: 'ana@acme.test',
      role: 'OWNER',
    });
    tokens.issueTokenPair.mockResolvedValue(PAIR);
    prisma.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => {
        const result = await fn(tx);
        calls.push('transaction-resolved');
        return result;
      },
    );
    jetstream.publish.mockImplementation((_t: string, event: string) => {
      calls.push(`publish:${event}`);
      return Promise.resolve();
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
        { provide: JwtService, useValue: {} },
        { provide: JetStreamService, useValue: jetstream },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('creates an ACTIVE tenant and an OWNER user and returns the token pair', async () => {
    const result = await service.register(dto);

    expect(result).toEqual(PAIR);
    expect(tx.tenant.create).toHaveBeenCalledWith({
      data: { name: 'Acme Security', status: 'ACTIVE' },
    });
    expect(userData()).toMatchObject({
      tenantId: TENANT_ID,
      email: 'ana@acme.test',
      role: 'OWNER',
    });
    expect(Object.keys(userData())).not.toContain('name');
  });

  it('stores an argon2id hash, never the plain password', async () => {
    await service.register(dto);

    const passwordHash = userData().passwordHash as string;
    expect(passwordHash).toMatch(/^\$argon2id\$/);
    expect(passwordHash).not.toContain(dto.password);
    await expect(verifyPassword(passwordHash, dto.password)).resolves.toBe(
      true,
    );
  });

  it('issues the token pair inside the transaction with the tx client', async () => {
    await service.register(dto);

    expect(tokens.issueTokenPair).toHaveBeenCalledWith(
      { id: USER_ID, tenantId: TENANT_ID, role: 'OWNER' },
      tx,
    );
  });

  it('ignores a role in the input: the user is always OWNER', async () => {
    await service.register({ ...dto, role: 'PLATFORM_ADMIN' } as typeof dto);

    expect(userData().role).toBe('OWNER');
  });

  it('normalizes the email (trim + lowercase) before storing it', async () => {
    await service.register({ ...dto, email: '  Ana@ACME.test ' });

    expect(userData().email).toBe('ana@acme.test');
  });

  it('answers email_taken 409 on a unique violation, whatever the case or spaces', async () => {
    tx.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );

    const error = await service
      .register({ ...dto, email: '  ANA@Acme.TEST  ' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(EmailTakenException);
    expect((error as EmailTakenException).getError()).toEqual(
      expect.objectContaining({ status: 409, code: 'email_taken' }),
    );
    expect(userData().email).toBe('ana@acme.test');
    expect(jetstream.publish).not.toHaveBeenCalled();
  });

  it('rethrows other database errors untouched and publishes nothing', async () => {
    const failure = new Error('connection lost');
    tx.user.create.mockRejectedValue(failure);

    await expect(service.register(dto)).rejects.toBe(failure);
    expect(jetstream.publish).not.toHaveBeenCalled();
  });

  it('publishes nothing until the transaction resolves', async () => {
    let release!: () => void;
    prisma.$transaction.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => {
        const result = await fn(tx);
        await new Promise<void>((resolve) => (release = resolve));
        return result;
      },
    );

    const pending = service.register(dto);
    // Password hashing runs first; wait until the transaction body finished.
    await waitUntil(() => tx.user.create.mock.calls.length > 0);
    await new Promise((resolve) => setImmediate(resolve));
    expect(jetstream.publish).not.toHaveBeenCalled();

    release();
    await pending;
    expect(jetstream.publish).toHaveBeenCalledTimes(2);
  });

  it('publishes tenant_created then user_created after the transaction', async () => {
    await service.register(dto);

    expect(calls).toEqual([
      'transaction-resolved',
      'publish:tenant_created',
      'publish:user_created',
    ]);
    expect(jetstream.publish).toHaveBeenNthCalledWith(
      1,
      TENANT_ID,
      'tenant_created',
      { tenantId: TENANT_ID, name: 'Acme Security', ownerId: USER_ID },
    );
    expect(jetstream.publish).toHaveBeenNthCalledWith(
      2,
      TENANT_ID,
      'user_created',
      {
        userId: USER_ID,
        tenantId: TENANT_ID,
        email: 'ana@acme.test',
        name: 'Ana Perez',
        role: 'owner',
      },
    );
  });

  it('does not put the password or its hash in any event', async () => {
    await service.register(dto);

    const published = JSON.stringify(jetstream.publish.mock.calls);
    expect(published).not.toContain(dto.password);
    expect(published).not.toContain('argon2');
  });
});
