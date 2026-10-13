import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { envs } from '../config';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserAssignSitesService } from './user-assign-sites.service';
import type { AssignUserSitesDto } from './dto/user-assign-sites.dto';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// The generated client is ESM-only; the services only need its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TARGET_ID = '0199b7e0-0000-7000-8000-000000000002';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';
const SITE_3 = '0199b7e0-0000-7000-8000-0000000000a3';

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type WireRole = AssignUserSitesDto['actor']['role'];

interface Stored {
  id: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  siteIds: string[];
}

interface Where {
  id: string;
  tenantId?: string;
  isActive?: boolean;
  role?: Role;
}

function matches(user: Stored, where: Where): boolean {
  return (
    user.id === where.id &&
    (where.tenantId === undefined || user.tenantId === where.tenantId) &&
    (where.isActive === undefined || user.isActive === where.isActive) &&
    (where.role === undefined || user.role === where.role)
  );
}

// Covers: S5.3
describe('UserAssignSitesService.assignSites', () => {
  let service: UserAssignSitesService;
  let auth: AuthService;
  let jwt: JwtService;
  let users: Stored[];
  let updateCount: number | undefined;
  const findFirst = jest.fn();
  const findUnique = jest.fn();
  const updateMany = jest.fn();
  const prisma = { user: { findFirst, findUnique, updateMany } };

  function supervisor(overrides: Partial<Stored> = {}): Stored {
    return {
      id: TARGET_ID,
      tenantId: TENANT_A,
      role: 'SUPERVISOR',
      isActive: true,
      siteIds: [],
      ...overrides,
    };
  }

  function dto(
    siteIds: string[],
    actorRole: WireRole = 'admin',
    overrides: Partial<AssignUserSitesDto['actor']> = {},
  ): AssignUserSitesDto {
    return {
      actor: {
        userId: ACTOR_ID,
        tenantId: TENANT_A,
        role: actorRole,
        ...overrides,
      },
      userId: TARGET_ID,
      siteIds,
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
    jest.resetAllMocks();
    users = [supervisor()];
    updateCount = undefined;

    findFirst.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(users.find((u) => matches(u, where)) ?? null),
    );
    // The row `auth.token.verify` reads, backed by the same store.
    findUnique.mockImplementation(({ where }: { where: Where }) => {
      const user = users.find((u) => matches(u, where));
      return Promise.resolve(
        user
          ? {
              ...user,
              tenant: { status: 'ACTIVE', plan: 'PRO', features: {} },
            }
          : null,
      );
    });
    updateMany.mockImplementation(
      ({ where, data }: { where: Where; data: { siteIds: string[] } }) => {
        const hits = users.filter((u) => matches(u, where));
        if (updateCount === undefined) {
          hits.forEach((u) => Object.assign(u, data));
        }
        return Promise.resolve({ count: updateCount ?? hits.length });
      },
    );

    const moduleRef = await Test.createTestingModule({
      imports: [
        JwtModule.register({
          secret: envs.jwtSecret,
          signOptions: { algorithm: 'HS256' },
        }),
      ],
      providers: [
        UserAssignSitesService,
        AuthService,
        TokenService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: { publish: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(UserAssignSitesService);
    auth = moduleRef.get(AuthService);
    jwt = moduleRef.get(JwtService);
  });

  describe('replacing the set', () => {
    it('stores the given set for a supervisor', async () => {
      await expect(
        service.assignSites(dto([SITE_1, SITE_2])),
      ).resolves.toEqual({ ok: true });

      expect(users[0].siteIds).toEqual([SITE_1, SITE_2]);
    });

    it('a second call with a different set leaves exactly the new set', async () => {
      await service.assignSites(dto([SITE_1, SITE_2]));
      await service.assignSites(dto([SITE_2, SITE_3]));

      expect(users[0].siteIds).toEqual([SITE_2, SITE_3]);
    });

    it('an empty set unassigns every site', async () => {
      users = [supervisor({ siteIds: [SITE_1] })];

      await service.assignSites(dto([]));

      expect(users[0].siteIds).toEqual([]);
    });

    it('removes duplicates before saving, keeping the first occurrence', async () => {
      await service.assignSites(dto([SITE_2, SITE_1, SITE_2, SITE_1]));

      expect(users[0].siteIds).toEqual([SITE_2, SITE_1]);
    });

    it('is allowed for an owner', async () => {
      await service.assignSites(dto([SITE_1], 'owner'));

      expect(users[0].siteIds).toEqual([SITE_1]);
    });

    it('only writes siteIds of the active supervisor row of the actor tenant', async () => {
      await service.assignSites(dto([SITE_1]));

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: TARGET_ID,
          tenantId: TENANT_A,
          isActive: true,
          role: 'SUPERVISOR',
        },
        data: { siteIds: [SITE_1] },
      });
    });
  });

  describe('verify returns the assigned set', () => {
    async function verifyTarget() {
      const accessToken = await jwt.signAsync(
        { tenantId: TENANT_A, role: 'supervisor' },
        { subject: TARGET_ID, jwtid: 'jti-1', expiresIn: 900 },
      );
      return auth.verify({ accessToken });
    }

    it('verify shows the new set after each assignment', async () => {
      await expect(verifyTarget()).resolves.toMatchObject({ siteIds: [] });

      await service.assignSites(dto([SITE_1, SITE_2]));
      await expect(verifyTarget()).resolves.toMatchObject({
        role: 'supervisor',
        siteIds: [SITE_1, SITE_2],
      });

      await service.assignSites(dto([SITE_3]));
      await expect(verifyTarget()).resolves.toMatchObject({
        siteIds: [SITE_3],
      });
    });
  });

  describe('targets and role table', () => {
    it.each(['OWNER', 'ADMIN', 'EMPLOYEE', 'PLATFORM_ADMIN'] as const)(
      'a %s target is forbidden and keeps no sites',
      async (role) => {
        users = [supervisor({ role })];

        expectForbidden(await errorOf(service.assignSites(dto([SITE_1]))));

        expect(users[0].siteIds).toEqual([]);
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it.each(['supervisor', 'employee', 'platform_admin'] as const)(
      'an actor with role %s is forbidden before any query',
      async (actorRole) => {
        expectForbidden(
          await errorOf(service.assignSites(dto([SITE_1], actorRole))),
        );

        expect(findFirst).not.toHaveBeenCalled();
      },
    );

    it('an owner/admin actor without a tenant is forbidden before any query', async () => {
      expectForbidden(
        await errorOf(
          service.assignSites(dto([SITE_1], 'owner', { tenantId: null })),
        ),
      );

      expect(findFirst).not.toHaveBeenCalled();
    });

    it('nobody assigns sites to themselves', async () => {
      users = [supervisor({ id: ACTOR_ID })];
      const own = dto([SITE_1], 'admin');
      own.userId = ACTOR_ID;

      expectForbidden(await errorOf(service.assignSites(own)));

      expect(users[0].siteIds).toEqual([]);
    });
  });

  describe('tenant isolation and existence', () => {
    it('an actor of tenant A cannot assign sites to a supervisor of tenant B', async () => {
      users = [supervisor({ tenantId: TENANT_B })];

      expectForbidden(
        await errorOf(service.assignSites(dto([SITE_1], 'owner'))),
      );

      expect(users[0].siteIds).toEqual([]);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('looks the target up with the tenant of the actor, never the payload', async () => {
      await service.assignSites(dto([SITE_1]));

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID, tenantId: TENANT_A, isActive: true },
        }),
      );
    });

    it('unknown and other-tenant users answer the same forbidden', async () => {
      users = [];
      const unknown = await errorOf(service.assignSites(dto([SITE_1])));
      users = [supervisor({ tenantId: TENANT_B })];
      const foreign = await errorOf(service.assignSites(dto([SITE_1])));

      expectForbidden(unknown);
      expect((foreign as ForbiddenException).getError()).toEqual(
        (unknown as ForbiddenException).getError(),
      );
    });

    it('an inactive supervisor is forbidden', async () => {
      users = [supervisor({ isActive: false })];

      expectForbidden(await errorOf(service.assignSites(dto([SITE_1]))));

      expect(users[0].siteIds).toEqual([]);
    });
  });

  describe('race safety', () => {
    it('is forbidden when the user stopped being a supervisor meanwhile', async () => {
      updateCount = 0;

      expectForbidden(await errorOf(service.assignSites(dto([SITE_1]))));
    });
  });
});
