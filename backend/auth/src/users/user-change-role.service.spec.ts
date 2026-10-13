import { Test } from '@nestjs/testing';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { UserChangeRoleService } from './user-change-role.service';
import type { ChangeUserRoleDto } from './dto/user-change-role.dto';

// The generated client is ESM-only; the service only needs its class shape.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));
jest.mock('../config', () => ({ envs: {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TARGET_ID = '0199b7e0-0000-7000-8000-000000000002';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';
type WireRole = ChangeUserRoleDto['actor']['role'];

interface Stored {
  id: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  siteIds: string[];
}

interface Where {
  id: string;
  tenantId: string;
  isActive: boolean;
  role?: Role;
}

function matches(user: Stored, where: Where): boolean {
  return (
    user.id === where.id &&
    user.tenantId === where.tenantId &&
    user.isActive === where.isActive &&
    (where.role === undefined || user.role === where.role)
  );
}

// Covers: S5.2
describe('UserChangeRoleService.changeRole', () => {
  let service: UserChangeRoleService;
  let users: Stored[];
  let updateCount: number | undefined;
  const calls: string[] = [];
  const findFirst = jest.fn();
  const updateMany = jest.fn();
  const tx = { user: { findFirst, updateMany } };
  const prisma = { $transaction: jest.fn() };
  const jetstream = { publish: jest.fn() };

  function target(overrides: Partial<Stored> = {}): Stored {
    return {
      id: TARGET_ID,
      tenantId: TENANT_A,
      role: 'EMPLOYEE',
      isActive: true,
      siteIds: [],
      ...overrides,
    };
  }

  function dto(
    role: ChangeUserRoleDto['role'],
    actorRole: WireRole = 'admin',
    overrides: Partial<ChangeUserRoleDto['actor']> = {},
  ): ChangeUserRoleDto {
    return {
      actor: {
        userId: ACTOR_ID,
        tenantId: TENANT_A,
        role: actorRole,
        ...overrides,
      },
      userId: TARGET_ID,
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
    jest.resetAllMocks();
    calls.length = 0;
    users = [target()];
    updateCount = undefined;

    findFirst.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(users.find((u) => matches(u, where)) ?? null),
    );
    updateMany.mockImplementation(
      ({
        where,
        data,
      }: {
        where: Where;
        data: { role: Role; siteIds: string[] };
      }) => {
        const hits = users.filter((u) => matches(u, where));
        if (updateCount === undefined) {
          hits.forEach((u) => Object.assign(u, data));
        }
        return Promise.resolve({ count: updateCount ?? hits.length });
      },
    );
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
        UserChangeRoleService,
        { provide: PrismaService, useValue: prisma },
        { provide: JetStreamService, useValue: jetstream },
      ],
    }).compile();
    service = moduleRef.get(UserChangeRoleService);
  });

  describe('allowed changes', () => {
    it('changes a supervisor to employee and leaves empty siteIds', async () => {
      users = [target({ role: 'SUPERVISOR', siteIds: [SITE_1, SITE_2] })];

      await expect(service.changeRole(dto('employee'))).resolves.toEqual({
        ok: true,
      });

      expect(users[0]).toMatchObject({ role: 'EMPLOYEE', siteIds: [] });
    });

    it('changes an employee to supervisor with no sites yet', async () => {
      await service.changeRole(dto('supervisor'));

      expect(users[0]).toMatchObject({ role: 'SUPERVISOR', siteIds: [] });
    });

    it.each([
      ['owner', 'EMPLOYEE', 'admin'],
      ['owner', 'SUPERVISOR', 'admin'],
      ['owner', 'ADMIN', 'employee'],
      ['owner', 'ADMIN', 'supervisor'],
    ] as const)('%s changes %s to %s', async (actorRole, current, next) => {
      users = [target({ role: current })];

      await service.changeRole(dto(next, actorRole));

      expect(users[0].role).toBe(next.toUpperCase());
    });

    it('clears siteIds on every role change', async () => {
      users = [target({ role: 'ADMIN', siteIds: [SITE_1] })];

      await service.changeRole(dto('employee', 'owner'));

      expect(users[0].siteIds).toEqual([]);
    });

    it('only writes the row of the actor tenant, with the authorized role', async () => {
      users = [target({ role: 'SUPERVISOR' })];

      await service.changeRole(dto('employee'));

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id: TARGET_ID,
          tenantId: TENANT_A,
          isActive: true,
          role: 'SUPERVISOR',
        },
        data: { role: 'EMPLOYEE', siteIds: [] },
      });
    });
  });

  describe('event', () => {
    it('emits user_role_changed with wire values after the commit', async () => {
      users = [target({ role: 'SUPERVISOR' })];

      await service.changeRole(dto('employee'));

      expect(jetstream.publish).toHaveBeenCalledTimes(1);
      expect(jetstream.publish).toHaveBeenCalledWith(
        TENANT_A,
        'user_role_changed',
        {
          userId: TARGET_ID,
          tenantId: TENANT_A,
          role: 'employee',
          actorId: ACTOR_ID,
        },
      );
      expect(calls).toEqual([
        'transaction-resolved',
        'publish:user_role_changed',
      ]);
    });

    it('is a no-op for the same role: no write and no event', async () => {
      await expect(service.changeRole(dto('employee'))).resolves.toEqual({
        ok: true,
      });

      expect(updateMany).not.toHaveBeenCalled();
      expect(jetstream.publish).not.toHaveBeenCalled();
    });

    it('does not emit when the change is refused', async () => {
      users = [target({ role: 'ADMIN' })];

      expectForbidden(await errorOf(service.changeRole(dto('employee'))));

      expect(jetstream.publish).not.toHaveBeenCalled();
    });
  });

  describe('role table', () => {
    it.each([
      ['admin', 'EMPLOYEE', 'admin'],
      ['admin', 'SUPERVISOR', 'admin'],
      ['admin', 'ADMIN', 'employee'],
      ['admin', 'ADMIN', 'supervisor'],
      ['owner', 'OWNER', 'admin'],
      ['owner', 'OWNER', 'employee'],
      ['admin', 'OWNER', 'employee'],
      ['owner', 'PLATFORM_ADMIN', 'employee'],
      ['admin', 'PLATFORM_ADMIN', 'supervisor'],
    ] as const)(
      '%s changing %s to %s is forbidden',
      async (a, current, next) => {
        users = [target({ role: current })];

        expectForbidden(await errorOf(service.changeRole(dto(next, a))));

        expect(users[0].role).toBe(current);
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it.each(['supervisor', 'employee', 'platform_admin'] as const)(
      'an actor with role %s is forbidden before any query',
      async (actorRole) => {
        expectForbidden(
          await errorOf(service.changeRole(dto('supervisor', actorRole))),
        );

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(findFirst).not.toHaveBeenCalled();
      },
    );

    it('an owner/admin actor without a tenant is forbidden before any query', async () => {
      expectForbidden(
        await errorOf(
          service.changeRole(dto('supervisor', 'owner', { tenantId: null })),
        ),
      );

      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('nobody changes their own role', async () => {
      users = [target({ id: ACTOR_ID, role: 'ADMIN' })];
      const own = dto('employee', 'owner');
      own.userId = ACTOR_ID;

      expectForbidden(await errorOf(service.changeRole(own)));

      expect(users[0].role).toBe('ADMIN');
    });
  });

  describe('tenant isolation and existence', () => {
    it('an actor of tenant A cannot change a user of tenant B', async () => {
      users = [target({ tenantId: TENANT_B })];

      expectForbidden(
        await errorOf(service.changeRole(dto('supervisor', 'owner'))),
      );

      expect(users[0].role).toBe('EMPLOYEE');
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('looks the target up with the tenant of the actor, never the payload', async () => {
      await service.changeRole(dto('supervisor'));

      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: TARGET_ID, tenantId: TENANT_A, isActive: true },
        }),
      );
    });

    it('unknown and other-tenant users answer the same forbidden', async () => {
      users = [];
      const unknown = await errorOf(service.changeRole(dto('supervisor')));
      users = [target({ tenantId: TENANT_B })];
      const foreign = await errorOf(service.changeRole(dto('supervisor')));

      expectForbidden(unknown);
      expect((foreign as ForbiddenException).getError()).toEqual(
        (unknown as ForbiddenException).getError(),
      );
    });

    it('an inactive user is forbidden', async () => {
      users = [target({ isActive: false })];

      expectForbidden(await errorOf(service.changeRole(dto('supervisor'))));

      expect(users[0].role).toBe('EMPLOYEE');
    });
  });

  describe('race safety', () => {
    it('is forbidden and silent when the role changed meanwhile', async () => {
      updateCount = 0;

      expectForbidden(await errorOf(service.changeRole(dto('supervisor'))));

      expect(jetstream.publish).not.toHaveBeenCalled();
    });
  });
});
