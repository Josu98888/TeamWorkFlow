import { Test } from '@nestjs/testing';
import { hashToken } from '../crypto';
import {
  EmailTakenException,
  ForbiddenException,
} from '../../common/exceptions/app.exceptions';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));
jest.mock('../../config', () => ({ envs: {} }));

const NOW = new Date('2026-10-12T10:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TENANT_ID = '0199b7e0-0000-7000-8000-000000000002';
const INVITATION_ID = '0199b7e0-0000-7000-8000-0000000000bb';

type WireRole =
  'owner' | 'admin' | 'supervisor' | 'employee' | 'platform_admin';
type InviteRole = 'admin' | 'supervisor' | 'employee';

// Covers: S4.1
describe('InvitationsService.create', () => {
  let service: InvitationsService;
  const userFindUnique = jest.fn();
  const updateMany = jest.fn();
  const create = jest.fn();
  const tx = {
    user: { findUnique: userFindUnique },
    invitation: { updateMany, create },
  };
  const prisma = {
    $transaction: jest.fn(),
  };

  function dto(
    role: InviteRole = 'employee',
    actorRole: WireRole = 'owner',
    overrides: { email?: string; tenantId?: string | null } = {},
  ) {
    return {
      actor: {
        userId: ACTOR_ID,
        tenantId:
          overrides.tenantId === undefined ? TENANT_ID : overrides.tenantId,
        role: actorRole,
      },
      email: overrides.email ?? 'new@acme.test',
      role,
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

  function expectForbidden(error: unknown) {
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getError()).toEqual(
      expect.objectContaining({ status: 403, code: 'forbidden' }),
    );
  }

  beforeEach(async () => {
    jest.useFakeTimers({ now: NOW });
    jest.resetAllMocks();
    userFindUnique.mockResolvedValue(null);
    updateMany.mockResolvedValue({ count: 0 });
    create.mockImplementation(({ data }: { data: { expiresAt: Date } }) =>
      Promise.resolve({ id: INVITATION_ID, expiresAt: data.expiresAt }),
    );
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get(InvitationsService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('role table', () => {
    it.each(['admin', 'supervisor', 'employee'] as const)(
      'owner can invite %s',
      async (role) => {
        const result = await service.create(dto(role, 'owner'));

        expect(result.invitationId).toBe(INVITATION_ID);
        const { data } = create.mock.calls[0][0] as {
          data: Record<string, unknown>;
        };
        expect(data.role).toBe(role.toUpperCase());
      },
    );

    it.each(['supervisor', 'employee'] as const)(
      'admin can invite %s',
      async (role) => {
        await expect(
          service.create(dto(role, 'admin')),
        ).resolves.toHaveProperty('token');
      },
    );

    it.each([
      ['admin', 'admin'],
      ['supervisor', 'employee'],
      ['supervisor', 'supervisor'],
      ['supervisor', 'admin'],
      ['employee', 'employee'],
      ['employee', 'admin'],
      ['platform_admin', 'employee'],
      ['platform_admin', 'admin'],
    ] as const)('%s inviting %s is forbidden', async (actorRole, role) => {
      expectForbidden(await errorOf(service.create(dto(role, actorRole))));
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('an actor without a tenant is forbidden', async () => {
      expectForbidden(
        await errorOf(
          service.create(dto('employee', 'owner', { tenantId: null })),
        ),
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('email', () => {
    it('an email that belongs to an existing user is email_taken', async () => {
      userFindUnique.mockResolvedValue({ id: 'someone' });

      const error = await errorOf(service.create(dto()));

      expect(error).toBeInstanceOf(EmailTakenException);
      expect((error as EmailTakenException).getError()).toEqual(
        expect.objectContaining({ status: 409, code: 'email_taken' }),
      );
      expect(create).not.toHaveBeenCalled();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('looks the user up globally (any tenant) by the normalized email', async () => {
      await service.create(
        dto('employee', 'owner', { email: ' New@ACME.test ' }),
      );

      expect(userFindUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'new@acme.test' } }),
      );
      const { data } = create.mock.calls[0][0] as {
        data: { email: string };
      };
      expect(data.email).toBe('new@acme.test');
    });
  });

  describe('invitation', () => {
    it('revokes the previous pending invitation of that email in the tenant only', async () => {
      await service.create(dto());

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          email: 'new@acme.test',
          usedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: NOW },
      });
    });

    it('revokes before creating the new invitation, in one transaction', async () => {
      const order: string[] = [];
      updateMany.mockImplementation(() => {
        order.push('revoke');
        return Promise.resolve({ count: 1 });
      });
      create.mockImplementation(() => {
        order.push('create');
        return Promise.resolve({ id: INVITATION_ID, expiresAt: NOW });
      });

      await service.create(dto());

      expect(order).toEqual(['revoke', 'create']);
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('stores only the hash and returns the raw token once', async () => {
      const result = await service.create(dto());

      expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const { data } = create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.tokenHash).toBe(hashToken(result.token));
      expect(JSON.stringify(data)).not.toContain(result.token);
    });

    it('expires in 7 days and returns the date as an ISO string', async () => {
      const result = await service.create(dto());

      const expected = new Date(NOW.getTime() + 7 * DAY);
      const { data } = create.mock.calls[0][0] as {
        data: { expiresAt: Date };
      };
      expect(data.expiresAt).toEqual(expected);
      expect(result.expiresAt).toBe(expected.toISOString());
    });

    it('takes tenant and inviter from the actor', async () => {
      await service.create(dto());

      const { data } = create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(data.tenantId).toBe(TENANT_ID);
      expect(data.invitedById).toBe(ACTOR_ID);
    });

    it('returns exactly invitationId, token and expiresAt', async () => {
      const result = await service.create(dto());

      expect(Object.keys(result).sort()).toEqual([
        'expiresAt',
        'invitationId',
        'token',
      ]);
    });
  });
});
