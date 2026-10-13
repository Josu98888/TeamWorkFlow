import { Test } from '@nestjs/testing';
import { TokenService } from '../auth/token.service';
import { hashToken } from '../common/crypto';
import {
  EmailTakenException,
  InvalidTokenException,
  TenantCancelledException,
  TenantSuspendedException,
} from '../common/exceptions/app.exceptions';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationAcceptService } from './invitation-accept.service';

// Argon2 is real in password.spec.ts; a cheap fake keeps this suite fast.
jest.mock('../common/crypto/password', () => ({
  hashPassword: (password: string) => Promise.resolve(`fake:${password}`),
  verifyPassword: (hash: string, password: string) =>
    Promise.resolve(hash === `fake:${password}`),
}));
// The generated client is ESM-only; the service only needs its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));
jest.mock('../config', () => ({ envs: {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const TENANT_ID = '0199b7e0-0000-7000-8000-00000000000a';
const USER_ID = '0199b7e0-0000-7000-8000-000000000001';
const INVITATION_ID = '0199b7e0-0000-7000-8000-0000000000aa';
const PAIR = { accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 };
const RAW_TOKEN = 'raw-invitation-token';

type InvitationRole = 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE';
type TenantStatus =
  'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';

interface Stored {
  id: string;
  tenantId: string;
  email: string;
  role: InvitationRole;
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
  tenant: { status: TenantStatus };
}

interface ConsumeArgs {
  where: {
    id: string;
    usedAt: null;
    revokedAt: null;
    expiresAt: { gt: Date };
  };
  data: { usedAt: Date };
}

const dto = {
  token: RAW_TOKEN,
  name: 'Ana Perez',
  password: 'correct horse battery',
};

// Covers: S4.4
describe('InvitationAcceptService.accept', () => {
  let service: InvitationAcceptService;
  let stored: Stored | null;
  let consumeCount: number | undefined;
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const userCreate = jest.fn();
  const tx = {
    invitation: { updateMany },
    user: { create: userCreate },
  };
  const prisma = { invitation: { findUnique }, $transaction: jest.fn() };
  const tokens = { issueTokenPair: jest.fn() };
  const jetstream = { publish: jest.fn() };
  const calls: string[] = [];

  function invitation(overrides: Partial<Stored> = {}): Stored {
    return {
      id: INVITATION_ID,
      tenantId: TENANT_ID,
      email: 'new@acme.test',
      role: 'EMPLOYEE',
      usedAt: null,
      revokedAt: null,
      expiresAt: new Date(NOW.getTime() + HOUR),
      tenant: { status: 'ACTIVE' },
      ...overrides,
    };
  }

  function errorOf(promise: Promise<unknown>) {
    return promise.then(
      () => {
        throw new Error('Expected the call to fail');
      },
      (error: unknown) => error,
    );
  }

  function expectInvalidToken(error: unknown) {
    expect(error).toBeInstanceOf(InvalidTokenException);
    expect((error as InvalidTokenException).getError()).toEqual(
      expect.objectContaining({ status: 401, code: 'invalid_token' }),
    );
  }

  function userData(): Record<string, unknown> {
    return (userCreate.mock.calls[0] as [{ data: Record<string, unknown> }])[0]
      .data;
  }

  beforeEach(async () => {
    // Fake only Date: Argon2 and Nest need real timers/ticks.
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    jest.resetAllMocks();
    calls.length = 0;
    stored = invitation();
    consumeCount = undefined;

    findUnique.mockImplementation(
      ({ where }: { where: { tokenHash: string } }) =>
        Promise.resolve(
          where.tokenHash === hashToken(RAW_TOKEN) ? stored : null,
        ),
    );
    updateMany.mockImplementation(({ where, data }: ConsumeArgs) => {
      const row = stored;
      const hit =
        row !== null &&
        row.id === where.id &&
        row.usedAt === null &&
        row.revokedAt === null &&
        row.expiresAt.getTime() > where.expiresAt.gt.getTime();
      if (hit && consumeCount === undefined) {
        row.usedAt = data.usedAt;
      }
      return Promise.resolve({ count: consumeCount ?? (hit ? 1 : 0) });
    });
    userCreate.mockImplementation(
      ({ data }: { data: { tenantId: string; email: string; role: string } }) =>
        Promise.resolve({ id: USER_ID, ...data }),
    );
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
        InvitationAcceptService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: tokens },
        { provide: JetStreamService, useValue: jetstream },
      ],
    }).compile();
    service = moduleRef.get(InvitationAcceptService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('happy path', () => {
    it('creates the user in the inviting tenant and returns the token pair', async () => {
      const result = await service.accept(dto);

      expect(result).toEqual(PAIR);
      expect(userData()).toMatchObject({
        tenantId: TENANT_ID,
        email: 'new@acme.test',
        role: 'EMPLOYEE',
      });
    });

    it.each([
      ['ADMIN', 'admin'],
      ['SUPERVISOR', 'supervisor'],
      ['EMPLOYEE', 'employee'],
    ] as const)('invited %s creates a %s user', async (role, wire) => {
      stored = invitation({ role });

      await service.accept(dto);

      expect(userData().role).toBe(role);
      expect(jetstream.publish).toHaveBeenCalledWith(
        TENANT_ID,
        'user_created',
        expect.objectContaining({ role: wire }),
      );
    });

    it('looks the invitation up by the hash of the token', async () => {
      await service.accept(dto);

      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tokenHash: hashToken(RAW_TOKEN) },
        }),
      );
    });

    it('stores the password hash, never the plain password', async () => {
      await service.accept(dto);

      expect(userData().passwordHash).toBe(`fake:${dto.password}`);
      expect(JSON.stringify(userData())).not.toContain(
        `"passwordHash":"${dto.password}"`,
      );
    });

    it('marks the invitation as used', async () => {
      await service.accept(dto);

      expect(stored?.usedAt).toEqual(NOW);
    });

    it('issues the token pair inside the transaction with the tx client', async () => {
      await service.accept(dto);

      expect(tokens.issueTokenPair).toHaveBeenCalledWith(
        { id: USER_ID, tenantId: TENANT_ID, role: 'EMPLOYEE' },
        tx,
      );
    });

    it('takes tenant, email and role only from the invitation', async () => {
      await service.accept({
        ...dto,
        role: 'OWNER',
        tenantId: 'other',
        email: 'attacker@evil.test',
      } as typeof dto);

      expect(userData()).toMatchObject({
        tenantId: TENANT_ID,
        email: 'new@acme.test',
        role: 'EMPLOYEE',
      });
    });

    it('emits user_created after the transaction commits, with the wire role and the name', async () => {
      await service.accept(dto);

      expect(calls).toEqual(['transaction-resolved', 'publish:user_created']);
      expect(jetstream.publish).toHaveBeenCalledWith(
        TENANT_ID,
        'user_created',
        {
          userId: USER_ID,
          tenantId: TENANT_ID,
          email: 'new@acme.test',
          name: 'Ana Perez',
          role: 'employee',
        },
      );
    });
  });

  describe('invalid tokens (generic invalid_token)', () => {
    it('unknown token', async () => {
      expectInvalidToken(
        await errorOf(service.accept({ ...dto, token: 'not-a-real-token' })),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('expired token', async () => {
      stored = invitation({ expiresAt: new Date(NOW.getTime() - 1) });

      expectInvalidToken(await errorOf(service.accept(dto)));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('token expiring exactly now', async () => {
      stored = invitation({ expiresAt: NOW });

      expectInvalidToken(await errorOf(service.accept(dto)));
    });

    it('used token', async () => {
      stored = invitation({ usedAt: new Date(NOW.getTime() - HOUR) });

      expectInvalidToken(await errorOf(service.accept(dto)));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('revoked token', async () => {
      stored = invitation({ revokedAt: new Date(NOW.getTime() - HOUR) });

      expectInvalidToken(await errorOf(service.accept(dto)));

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('token of a deleted tenant', async () => {
      stored = invitation({ tenant: { status: 'DELETED' } });

      expectInvalidToken(await errorOf(service.accept(dto)));
    });

    it('a used token cannot be accepted twice', async () => {
      await service.accept(dto);

      expectInvalidToken(await errorOf(service.accept(dto)));
      expect(userCreate).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['unknown', null],
      ['expired', { expiresAt: new Date(NOW.getTime() - 1) }],
      ['used', { usedAt: new Date(NOW.getTime() - HOUR) }],
      ['revoked', { revokedAt: new Date(NOW.getTime() - HOUR) }],
    ] as const)(
      'the %s case creates no user and emits nothing',
      async (_label, overrides) => {
        stored = overrides === null ? null : invitation(overrides);

        await errorOf(service.accept(dto));

        expect(userCreate).not.toHaveBeenCalled();
        expect(tokens.issueTokenPair).not.toHaveBeenCalled();
        expect(jetstream.publish).not.toHaveBeenCalled();
      },
    );

    it('loses the race: another accept consumed it first (count 0)', async () => {
      consumeCount = 0;

      expectInvalidToken(await errorOf(service.accept(dto)));

      expect(userCreate).not.toHaveBeenCalled();
      expect(jetstream.publish).not.toHaveBeenCalled();
    });
  });

  describe('tenant status', () => {
    it.each(['SUPERVISOR', 'EMPLOYEE'] as const)(
      'a %s of a suspended tenant gets tenant_suspended and the invitation stays unused',
      async (role) => {
        stored = invitation({ role, tenant: { status: 'SUSPENDED' } });

        const error = await errorOf(service.accept(dto));

        expect(error).toBeInstanceOf(TenantSuspendedException);
        expect(stored.usedAt).toBeNull();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(jetstream.publish).not.toHaveBeenCalled();
      },
    );

    it('a supervisor of a cancelled tenant gets tenant_cancelled', async () => {
      stored = invitation({
        role: 'SUPERVISOR',
        tenant: { status: 'CANCELLED' },
      });

      expect(await errorOf(service.accept(dto))).toBeInstanceOf(
        TenantCancelledException,
      );
    });

    it.each(['SUSPENDED', 'CANCELLED', 'PAST_DUE'] as const)(
      'an admin of a %s tenant can still accept (owner/admin are never blocked)',
      async (status) => {
        stored = invitation({ role: 'ADMIN', tenant: { status } });

        await expect(service.accept(dto)).resolves.toEqual(PAIR);
      },
    );

    it('a past_due tenant restricts nobody', async () => {
      stored = invitation({ tenant: { status: 'PAST_DUE' } });

      await expect(service.accept(dto)).resolves.toEqual(PAIR);
    });
  });

  describe('failures inside the transaction', () => {
    it('email already registered (unique violation) is email_taken and emits nothing', async () => {
      userCreate.mockRejectedValue({ code: 'P2002' });

      const error = await errorOf(service.accept(dto));

      expect(error).toBeInstanceOf(EmailTakenException);
      expect(jetstream.publish).not.toHaveBeenCalled();
      expect(calls).not.toContain('transaction-resolved');
    });

    it('does not emit user_created when the transaction fails', async () => {
      tokens.issueTokenPair.mockRejectedValue(new Error('db down'));

      await expect(service.accept(dto)).rejects.toThrow('db down');

      expect(jetstream.publish).not.toHaveBeenCalled();
    });

    it('rethrows unexpected errors as they are', async () => {
      userCreate.mockRejectedValue(new Error('boom'));

      await expect(service.accept(dto)).rejects.toThrow('boom');
    });
  });
});
