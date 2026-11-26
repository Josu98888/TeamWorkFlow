import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { verifyPassword } from './crypto';
import {
  EmailTakenException,
  ForbiddenException,
  TenantCancelledException,
  TenantSuspendedException,
} from '../common/exceptions/app.exceptions';
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
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

jest.setTimeout(30_000);

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const NEW_USER_ID = '0199b7e0-0000-7000-8000-000000000099';

// Covers: EMP-1.1
describe('AuthService.provisionEmployeeAccount', () => {
  let service: AuthService;
  const tx = {
    invitation: { updateMany: jest.fn() },
    user: { create: jest.fn() },
  };
  const prisma = {
    user: { findUnique: jest.fn() },
    tenant: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };
  const jetstream = { publish: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    tx.invitation.updateMany.mockResolvedValue({ count: 0 });
    tx.user.create.mockResolvedValue({
      id: NEW_USER_ID,
      tenantId: TENANT_A,
      email: 'juan.perez@acme.test',
      role: 'EMPLOYEE',
    });
    prisma.$transaction.mockImplementation(
      (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    jetstream.publish.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: TokenService, useValue: {} },
        { provide: JwtService, useValue: {} },
        { provide: JetStreamService, useValue: jetstream },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('creates an active EMPLOYEE user with an argon2id hash, revokes pending invitations and emits user_created', async () => {
    const result = await service.provisionEmployeeAccount({
      actor: { userId: ACTOR_ID, tenantId: TENANT_A, role: 'owner' },
      email: '  Juan.Perez@ACME.test ',
      name: '  Juan Perez ',
      password: 'SecurePassword123',
    });

    expect(result).toEqual({
      userId: NEW_USER_ID,
      email: 'juan.perez@acme.test',
      created: true,
    });
    expect(tx.invitation.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: TENANT_A,
        email: 'juan.perez@acme.test',
        usedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
    const createdArgs = tx.user.create.mock.calls[0][0] as {
      data: {
        tenantId: string;
        email: string;
        passwordHash: string;
        role: string;
        isActive: boolean;
      };
    };
    expect(createdArgs.data).toMatchObject({
      tenantId: TENANT_A,
      email: 'juan.perez@acme.test',
      role: 'EMPLOYEE',
      isActive: true,
    });
    expect(createdArgs.data.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(
      verifyPassword(createdArgs.data.passwordHash, 'SecurePassword123'),
    ).resolves.toBe(true);
    expect(jetstream.publish).toHaveBeenCalledWith(TENANT_A, 'user_created', {
      userId: NEW_USER_ID,
      tenantId: TENANT_A,
      email: 'juan.perez@acme.test',
      name: 'Juan Perez',
      role: 'employee',
    });
    const published = JSON.stringify(jetstream.publish.mock.calls);
    expect(published).not.toContain('SecurePassword123');
    expect(published).not.toContain('argon2');
  });

  it('returns existing userId with created: false when email already belongs to the same active tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'existing-user-id',
      tenantId: TENANT_A,
      tenant: { status: 'ACTIVE' },
    });

    const result = await service.provisionEmployeeAccount({
      actor: { userId: ACTOR_ID, tenantId: TENANT_A, role: 'admin' },
      email: 'Juan.Perez@acme.test',
      name: 'Juan Perez',
      password: 'SecurePassword123',
    });

    expect(result).toEqual({
      userId: 'existing-user-id',
      email: 'juan.perez@acme.test',
      created: false,
    });
    expect(tx.user.create).not.toHaveBeenCalled();
    expect(jetstream.publish).not.toHaveBeenCalled();
  });

  it('rejects with 409 email_taken when email belongs to another tenant', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'other-tenant-user',
      tenantId: TENANT_B,
      tenant: { status: 'ACTIVE' },
    });

    await expect(
      service.provisionEmployeeAccount({
        actor: { userId: ACTOR_ID, tenantId: TENANT_A, role: 'owner' },
        email: 'juan.perez@acme.test',
        name: 'Juan Perez',
        password: 'SecurePassword123',
      }),
    ).rejects.toBeInstanceOf(EmailTakenException);
    expect(tx.user.create).not.toHaveBeenCalled();
  });

  it('translates a P2002 race on users.email for another tenant into 409 email_taken', async () => {
    tx.user.create.mockRejectedValue(
      Object.assign(new Error('Unique constraint failed'), { code: 'P2002' }),
    );
    prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'other', tenantId: TENANT_B });

    await expect(
      service.provisionEmployeeAccount({
        actor: { userId: ACTOR_ID, tenantId: TENANT_A, role: 'owner' },
        email: 'juan.perez@acme.test',
        name: 'Juan Perez',
        password: 'SecurePassword123',
      }),
    ).rejects.toBeInstanceOf(EmailTakenException);
    expect(jetstream.publish).not.toHaveBeenCalled();
  });

  it.each([
    ['supervisor', TENANT_A],
    ['employee', TENANT_A],
    ['platform_admin', null],
  ] as const)(
    'refuses role %s with ForbiddenException',
    async (role, tenantId) => {
      await expect(
        service.provisionEmployeeAccount({
          actor: { userId: ACTOR_ID, tenantId, role },
          email: 'juan.perez@acme.test',
          name: 'Juan Perez',
          password: 'SecurePassword123',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.user.create).not.toHaveBeenCalled();
    },
  );

  it('blocks provisioning when the tenant is suspended or cancelled', async () => {
    prisma.tenant.findUnique.mockResolvedValueOnce({ status: 'SUSPENDED' });
    await expect(
      service.provisionEmployeeAccount({
        actor: { userId: ACTOR_ID, tenantId: TENANT_A, role: 'owner' },
        email: 'juan.perez@acme.test',
        name: 'Juan Perez',
        password: 'SecurePassword123',
      }),
    ).rejects.toBeInstanceOf(TenantSuspendedException);

    prisma.tenant.findUnique.mockResolvedValueOnce({ status: 'CANCELLED' });
    await expect(
      service.provisionEmployeeAccount({
        actor: { userId: ACTOR_ID, tenantId: TENANT_A, role: 'owner' },
        email: 'juan.perez@acme.test',
        name: 'Juan Perez',
        password: 'SecurePassword123',
      }),
    ).rejects.toBeInstanceOf(TenantCancelledException);
  });
});
