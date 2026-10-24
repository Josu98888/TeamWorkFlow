import { Logger } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth.service';
import { TokenService } from '../token.service';
import {
  EmailTakenException,
  InvalidCredentialsException,
  InvalidTokenException,
} from '../../common/exceptions/app.exceptions';
import { envs } from '../../config';
import { subjectMatches } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import { JetStreamService } from '../events/jetstream.service';
import type { ConsumedMessage } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantPurgeHandlers } from './tenant-purge.handlers';

jest.mock('../../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
jest.mock('../prisma/generated/client', () => ({
  PrismaClient: class {},
  Prisma: { DbNull: 'DbNull' },
}));

// Real Argon2 hashing is slow when the whole suite runs in parallel.
jest.setTimeout(30_000);

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const AT = '2026-10-13T10:00:00.000Z';
const FUTURE = new Date('2027-01-01T00:00:00.000Z');
const PASSWORD = 'correct horse battery';

type Status = 'ACTIVE' | 'PAST_DUE' | 'SUSPENDED' | 'CANCELLED' | 'DELETED';
type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';

interface StoredTenant {
  id: string;
  name: string;
  status: Status;
  pastDueSince: Date | null;
  suspendedAt: Date | null;
  cancelledAt: Date | null;
  plan: string | null;
  features: unknown;
  planUpdatedAt: Date | null;
}

interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
  siteIds: string[];
}

interface StoredToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface Row {
  id: string;
  tenantId?: string | null;
  userId?: string;
}

interface Store {
  tenants: StoredTenant[];
  users: StoredUser[];
  refreshTokens: StoredToken[];
  resetTokens: Row[];
  invitations: Row[];
  processed: Row[];
}

const cancelledTenant = (): StoredTenant => ({
  id: TENANT_A,
  name: 'Acme',
  status: 'CANCELLED',
  pastDueSince: new Date('2026-08-01T00:00:00.000Z'),
  suspendedAt: new Date('2026-08-08T00:00:00.000Z'),
  cancelledAt: new Date('2026-09-01T00:00:00.000Z'),
  plan: 'PRO',
  features: { tasks: true },
  planUpdatedAt: new Date('2026-07-01T00:00:00.000Z'),
});

// Covers: S7.4
describe('data_retention_expired (tenant data purge)', () => {
  let db: Store;
  let nextId: number;
  let auth: AuthService;
  let tokens: TokenService;
  let handlers: {
    filter: string;
    run: (m: ConsumedMessage) => Promise<void>;
  }[];
  const publish = jest.fn();
  const prisma = {
    tenant: {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    },
    refreshToken: {
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    passwordResetToken: { deleteMany: jest.fn() },
    invitation: { deleteMany: jest.fn() },
    processedEvent: { createMany: jest.fn(), deleteMany: jest.fn() },
    $transaction: jest.fn(),
  };

  function id() {
    return `0199b7e0-0000-7000-8000-${String(nextId++).padStart(12, '0')}`;
  }

  function seedTenantData(tenantId: string, label: string) {
    const roles: Role[] = ['OWNER', 'ADMIN', 'SUPERVISOR', 'EMPLOYEE'];
    for (const role of roles) {
      const userId = `${label}-${role}`;
      db.users.push({
        id: userId,
        email: `${userId.toLowerCase()}@example.com`,
        passwordHash: 'hash',
        tenantId,
        role,
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        siteIds: [],
      });
      db.refreshTokens.push({
        id: `${userId}-rt`,
        userId,
        tokenHash: `${userId}-hash`,
        expiresAt: FUTURE,
        revokedAt: null,
      });
      db.resetTokens.push({ id: `${userId}-reset`, userId });
    }
    db.invitations.push(
      { id: `${label}-inv-1`, tenantId },
      { id: `${label}-inv-2`, tenantId },
    );
    db.processed.push({ id: `${label}-old-event`, tenantId });
  }

  function deliver(
    options: {
      tenantId?: string;
      payloadTenantId?: string;
      eventId?: string;
    } = {},
  ) {
    const tenantId = options.tenantId ?? TENANT_A;
    const subject = `t.${tenantId}.billing.data_retention_expired`;
    const handler = handlers.find(({ filter }) =>
      subjectMatches(filter, subject),
    );
    if (!handler) throw new Error(`No handler for ${subject}`);
    return handler.run({
      subject,
      tenantId,
      payload: {
        eventId: options.eventId ?? id(),
        tenantId: options.payloadTenantId ?? tenantId,
        occurredAt: AT,
      },
    });
  }

  const tenantOf = (tenantId = TENANT_A) =>
    db.tenants.find((t) => t.id === tenantId)!;
  // Seeded ids start with the label of their tenant ('a-' or 'b-').
  const COLLECTIONS = [
    'users',
    'refreshTokens',
    'resetTokens',
    'invitations',
    'processed',
  ] as const;
  const idsOf = (collection: (typeof COLLECTIONS)[number], label: string) =>
    (db[collection] as { id: string }[])
      .map((row) => row.id)
      .filter((rowId) => rowId.startsWith(`${label}-`));

  const snapshot = (): Store => structuredClone(db);

  const deleteWhere = <T>(rows: T[], doomed: (row: T) => boolean) => {
    const keep = rows.filter((row) => !doomed(row));
    const count = rows.length - keep.length;
    rows.splice(0, rows.length, ...keep);
    return Promise.resolve({ count });
  };

  const ownerTenant = (userId?: string) =>
    db.users.find((u) => u.id === userId)?.tenantId;

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    nextId = 1;
    handlers = [];
    db = {
      tenants: [cancelledTenant()],
      users: [],
      refreshTokens: [],
      resetTokens: [],
      invitations: [],
      processed: [],
    };
    seedTenantData(TENANT_A, 'a');
    db.tenants.push({ ...cancelledTenant(), id: TENANT_B, status: 'ACTIVE' });
    seedTenantData(TENANT_B, 'b');
    db.users.push({
      id: 'platform-admin',
      email: 'platform@example.com',
      passwordHash: 'hash',
      tenantId: null,
      role: 'PLATFORM_ADMIN',
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      siteIds: [],
    });
    db.refreshTokens.push({
      id: 'platform-rt',
      userId: 'platform-admin',
      tokenHash: 'platform-hash',
      expiresAt: FUTURE,
      revokedAt: null,
    });

    prisma.tenant.create.mockImplementation(
      ({ data }: { data: { name: string; status: Status } }) => {
        const row = { ...cancelledTenant(), ...data, id: id() };
        Object.assign(row, {
          pastDueSince: null,
          suspendedAt: null,
          cancelledAt: null,
          plan: null,
          features: null,
          planUpdatedAt: null,
        });
        db.tenants.push(row);
        return Promise.resolve(row);
      },
    );
    prisma.tenant.findUnique.mockImplementation(
      ({ where }: { where: { id: string } }) => {
        const found = db.tenants.find((t) => t.id === where.id);
        return Promise.resolve(found ? { status: found.status } : null);
      },
    );
    prisma.tenant.updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: { id: string; status: Status };
        data: Partial<StoredTenant>;
      }) => {
        const hits = db.tenants.filter(
          (t) => t.id === where.id && t.status === where.status,
        );
        hits.forEach((t) => Object.assign(t, data));
        return Promise.resolve({ count: hits.length });
      },
    );
    prisma.user.create.mockImplementation(
      ({ data }: { data: Partial<StoredUser> & { email: string } }) => {
        if (db.users.some((u) => u.email === data.email)) {
          return Promise.reject(
            Object.assign(new Error('Unique constraint failed'), {
              code: 'P2002',
            }),
          );
        }
        const row = {
          failedLoginAttempts: 0,
          lockedUntil: null,
          isActive: true,
          siteIds: [],
          ...data,
          id: id(),
        } as StoredUser;
        db.users.push(row);
        return Promise.resolve(row);
      },
    );
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; email?: string } }) => {
        const found = db.users.find(
          (u) =>
            (where.id === undefined || u.id === where.id) &&
            (where.email === undefined || u.email === where.email),
        );
        const tenant = db.tenants.find((t) => t.id === found?.tenantId);
        return Promise.resolve(
          found ? { ...found, tenant: tenant ?? null } : null,
        );
      },
    );
    prisma.refreshToken.create.mockImplementation(
      ({ data }: { data: Omit<StoredToken, 'id' | 'revokedAt'> }) => {
        const row = { id: id(), revokedAt: null, ...data };
        db.refreshTokens.push(row);
        return Promise.resolve(row);
      },
    );
    prisma.refreshToken.deleteMany.mockImplementation(
      ({ where }: { where: { user: { tenantId: string } } }) =>
        deleteWhere(
          db.refreshTokens,
          (t) => ownerTenant(t.userId) === where.user.tenantId,
        ),
    );
    prisma.passwordResetToken.deleteMany.mockImplementation(
      ({ where }: { where: { user: { tenantId: string } } }) =>
        deleteWhere(
          db.resetTokens,
          (t) => ownerTenant(t.userId) === where.user.tenantId,
        ),
    );
    prisma.invitation.deleteMany.mockImplementation(
      ({ where }: { where: { tenantId: string } }) =>
        deleteWhere(db.invitations, (i) => i.tenantId === where.tenantId),
    );
    prisma.user.deleteMany.mockImplementation(
      ({ where }: { where: { tenantId: string } }) =>
        deleteWhere(db.users, (u) => u.tenantId === where.tenantId),
    );
    prisma.processedEvent.createMany.mockImplementation(
      ({ data }: { data: { eventId: string; tenantId: string }[] }) => {
        const fresh = data.filter(
          (row) => !db.processed.some((p) => p.id === row.eventId),
        );
        fresh.forEach((row) =>
          db.processed.push({ id: row.eventId, tenantId: row.tenantId }),
        );
        return Promise.resolve({ count: fresh.length });
      },
    );
    prisma.processedEvent.deleteMany.mockImplementation(
      ({ where }: { where: { tenantId: string } }) =>
        deleteWhere(db.processed, (p) => p.tenantId === where.tenantId),
    );
    prisma.$transaction.mockImplementation(
      async (callback: (tx: typeof prisma) => Promise<unknown>) => {
        const before = snapshot();
        try {
          return await callback(prisma);
        } catch (error) {
          // Mutates in place: the mocks above close over the same arrays.
          for (const key of Object.keys(before) as (keyof Store)[]) {
            (db[key] as unknown[]).splice(
              0,
              db[key].length,
              ...(before[key] as unknown[]),
            );
          }
          throw error;
        }
      },
    );
    publish.mockResolvedValue(undefined);

    const jetstream = {
      registerHandler: (
        filter: string,
        run: (m: ConsumedMessage) => Promise<void>,
      ) => handlers.push({ filter, run }),
      publish,
    };
    new TenantPurgeHandlers(
      new ConsumedEventProcessor(prisma as never, jetstream as never),
    ).onModuleInit();

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: { publish } },
      ],
    }).compile();
    auth = moduleRef.get(AuthService);
    tokens = moduleRef.get(TokenService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('a cancelled tenant', () => {
    it('deletes its users, refresh tokens, reset tokens, invitations and processed events', async () => {
      await deliver();

      for (const collection of COLLECTIONS) {
        expect([collection, idsOf(collection, 'a')]).toEqual([collection, []]);
      }
    });

    it('also deletes the processed row of the purge event itself', async () => {
      const eventId = id();

      await deliver({ eventId });

      expect(db.processed.some((p) => p.id === eventId)).toBe(false);
    });

    it('keeps only a tombstone: id, name and status deleted, everything else cleared', async () => {
      await deliver();

      expect(tenantOf()).toEqual({
        id: TENANT_A,
        name: 'Acme',
        status: 'DELETED',
        pastDueSince: null,
        suspendedAt: null,
        cancelledAt: null,
        plan: null,
        features: 'DbNull',
        planUpdatedAt: null,
      });
      expect(db.tenants).toHaveLength(2);
    });

    it('emits nothing', async () => {
      await deliver();

      expect(publish).not.toHaveBeenCalled();
    });

    it('does not touch other tenants nor the platform_admin', async () => {
      const before = snapshot();

      await deliver();

      expect(tenantOf(TENANT_B)).toEqual(before.tenants[1]);
      for (const collection of COLLECTIONS) {
        expect(idsOf(collection, 'b').length).toBeGreaterThan(0);
        expect(idsOf(collection, 'b')).toEqual(
          (before[collection] as { id: string }[])
            .map((row) => row.id)
            .filter((rowId) => rowId.startsWith('b-')),
        );
      }
      expect(db.users.map((u) => u.id)).toContain('platform-admin');
      expect(db.refreshTokens.map((t) => t.id)).toContain('platform-rt');
    });

    it('is idempotent: another delivery finds the tenant deleted and changes nothing', async () => {
      await deliver();
      const after = snapshot();
      prisma.user.deleteMany.mockClear();

      await deliver();

      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      // Only the processed row of the second event was added and kept.
      expect(db.users).toEqual(after.users);
      expect(db.tenants).toEqual(after.tenants);
    });

    it('a redelivery of the same event is a no-op', async () => {
      const eventId = id();
      await deliver({ eventId });
      prisma.user.deleteMany.mockClear();
      prisma.tenant.updateMany.mockClear();

      await deliver({ eventId });

      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
      expect(prisma.tenant.updateMany).not.toHaveBeenCalled();
      expect(tenantOf().status).toBe('DELETED');
    });

    it('a failure in the middle rolls everything back (nothing half deleted)', async () => {
      const before = snapshot();
      prisma.user.deleteMany.mockRejectedValueOnce(new Error('db'));

      await expect(deliver()).rejects.toThrow('db');

      expect(db).toEqual(before);
    });

    it('a tenant reactivated between the read and the claim rolls back', async () => {
      const before = snapshot();
      prisma.tenant.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(deliver()).rejects.toThrow(
        'Tenant status changed concurrently',
      );

      expect(db).toEqual(before);
    });
  });

  describe('ignored events', () => {
    it.each(['ACTIVE', 'PAST_DUE', 'SUSPENDED', 'DELETED'] as const)(
      'while the tenant is %s nothing is deleted',
      async (status) => {
        tenantOf().status = status;
        const before = snapshot();

        await deliver();

        expect(prisma.user.deleteMany).not.toHaveBeenCalled();
        expect(db.users).toEqual(before.users);
        expect(db.refreshTokens).toEqual(before.refreshTokens);
        expect(db.invitations).toEqual(before.invitations);
        expect(db.tenants).toEqual(before.tenants);
      },
    );

    it('an unknown tenant is a no-op that resolves (ack)', async () => {
      await expect(
        deliver({ tenantId: '0199b7e0-0000-7000-8000-0000000000ff' }),
      ).resolves.toBeUndefined();

      expect(prisma.user.deleteMany).not.toHaveBeenCalled();
    });

    it('a subject tenant that differs from the payload tenant deletes nothing', async () => {
      const before = snapshot();

      await deliver({ tenantId: TENANT_A, payloadTenantId: TENANT_B });

      expect(db).toEqual(before);
    });
  });

  describe('the purged email is free again (real AuthService)', () => {
    const register = (email: string) =>
      auth.register({
        tenantName: 'New Acme',
        name: 'Ana',
        email,
        password: PASSWORD,
      });

    it('cannot register before the purge, can register after it as a new tenant', async () => {
      await expect(register('a-owner@example.com')).rejects.toBeInstanceOf(
        EmailTakenException,
      );
      const tenantsBefore = db.tenants.length;

      await deliver();
      await expect(register('a-owner@example.com')).resolves.toHaveProperty(
        'accessToken',
      );

      expect(db.tenants).toHaveLength(tenantsBefore + 1);
      const created = db.users.find((u) => u.email === 'a-owner@example.com');
      expect(created).toMatchObject({ role: 'OWNER' });
      expect(created?.tenantId).not.toBe(TENANT_A);
    });

    it('the purged users cannot log in or pass verify any more', async () => {
      const owner = db.users.find((u) => u.id === 'a-OWNER')!;
      const pair = await tokens.issueTokenPair(owner);

      await deliver();

      await expect(
        auth.login({ email: owner.email, password: PASSWORD }),
      ).rejects.toBeInstanceOf(InvalidCredentialsException);
      await expect(
        auth.verify({ accessToken: pair.accessToken }),
      ).rejects.toBeInstanceOf(InvalidTokenException);
    });
  });

  it('an ignored event keeps its processed row (dedupe still works)', async () => {
    tenantOf().status = 'ACTIVE';
    const eventId = id();

    await deliver({ eventId });

    expect(db.processed.map((p) => p.id)).toContain(eventId);
  });
});
