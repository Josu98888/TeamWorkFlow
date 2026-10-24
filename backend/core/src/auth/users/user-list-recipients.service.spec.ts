import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { UserListRecipientsService } from './user-list-recipients.service';
import type { ListRecipientsDto } from './dto/user-list-recipients.dto';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';

type Role = 'OWNER' | 'ADMIN' | 'SUPERVISOR' | 'EMPLOYEE' | 'PLATFORM_ADMIN';

interface StoredUser {
  id: string;
  tenantId: string | null;
  role: Role;
  isActive: boolean;
  siteIds: string[];
}

interface Clause {
  role?: Role | { in: Role[] };
  siteIds?: { has: string };
}

interface Where extends Clause {
  tenantId?: string;
  isActive?: boolean;
  OR?: Clause[];
}

function clauseMatches(user: StoredUser, clause: Clause): boolean {
  let role = true;
  if (typeof clause.role === 'string') {
    role = user.role === clause.role;
  } else if (clause.role !== undefined) {
    role = clause.role.in.includes(user.role);
  }
  return (
    role &&
    (clause.siteIds === undefined || user.siteIds.includes(clause.siteIds.has))
  );
}

function matches(user: StoredUser, where: Where): boolean {
  return (
    (where.tenantId === undefined || user.tenantId === where.tenantId) &&
    (where.isActive === undefined || user.isActive === where.isActive) &&
    clauseMatches(user, where) &&
    (where.OR === undefined || where.OR.some((c) => clauseMatches(user, c)))
  );
}

// Ids sort in creation order, like uuid v7.
const id = (n: number) =>
  `0199b7e0-0000-7000-8000-0000000001${String(n).padStart(2, '0')}`;

// Covers: S5.5
describe('UserListRecipientsService.listRecipients', () => {
  let service: UserListRecipientsService;
  let users: StoredUser[];
  const findMany = jest.fn();

  function user(n: number, overrides: Partial<StoredUser> = {}): StoredUser {
    return {
      id: id(n),
      tenantId: TENANT_A,
      role: 'EMPLOYEE',
      isActive: true,
      siteIds: [],
      ...overrides,
    };
  }

  function dto(overrides: Partial<ListRecipientsDto> = {}): ListRecipientsDto {
    return { tenantId: TENANT_A, roles: ['owner'], ...overrides };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    users = [];
    findMany.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(
        users
          .filter((u) => matches(u, where))
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((u) => ({ id: u.id })),
      ),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        UserListRecipientsService,
        { provide: PrismaService, useValue: { user: { findMany } } },
      ],
    }).compile();
    service = moduleRef.get(UserListRecipientsService);
  });

  describe('without siteId', () => {
    it('returns the active users of the requested roles only', async () => {
      users = [
        user(1, { role: 'OWNER' }),
        user(2, { role: 'ADMIN' }),
        user(3, { role: 'SUPERVISOR' }),
        user(4, { role: 'EMPLOYEE' }),
      ];

      await expect(
        service.listRecipients(dto({ roles: ['owner', 'supervisor'] })),
      ).resolves.toEqual({ userIds: [id(1), id(3)] });
    });

    it('excludes inactive users', async () => {
      users = [
        user(1, { role: 'ADMIN' }),
        user(2, { role: 'ADMIN', isActive: false }),
      ];

      await expect(
        service.listRecipients(dto({ roles: ['admin'] })),
      ).resolves.toEqual({ userIds: [id(1)] });
    });

    it('excludes users of other tenants and platform_admin', async () => {
      users = [
        user(1, { role: 'OWNER' }),
        user(2, { role: 'OWNER', tenantId: TENANT_B }),
        user(3, { role: 'PLATFORM_ADMIN', tenantId: null }),
      ];

      await expect(service.listRecipients(dto())).resolves.toEqual({
        userIds: [id(1)],
      });
    });

    it('returns every supervisor of the tenant whatever their sites', async () => {
      users = [
        user(1, { role: 'SUPERVISOR', siteIds: [SITE_1] }),
        user(2, { role: 'SUPERVISOR', siteIds: [] }),
      ];

      await expect(
        service.listRecipients(dto({ roles: ['supervisor'] })),
      ).resolves.toEqual({ userIds: [id(1), id(2)] });
    });

    it('returns an empty list when nobody matches', async () => {
      await expect(service.listRecipients(dto())).resolves.toEqual({
        userIds: [],
      });
    });

    it('filters by tenant and active status in the query', async () => {
      await service.listRecipients(dto({ roles: ['employee'] }));

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_A,
            isActive: true,
            role: { in: ['EMPLOYEE'] },
          },
          select: { id: true },
        }),
      );
    });

    it('is ordered deterministically by id, whatever the stored order', async () => {
      users = [
        user(3, { role: 'ADMIN' }),
        user(1, { role: 'ADMIN' }),
        user(2, { role: 'ADMIN' }),
      ];

      const result = await service.listRecipients(dto({ roles: ['admin'] }));

      expect(result.userIds).toEqual([id(1), id(2), id(3)]);
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { id: 'asc' } }),
      );
    });
  });

  describe('with siteId', () => {
    const roles: ListRecipientsDto['roles'] = [
      'owner',
      'admin',
      'supervisor',
      'employee',
    ];

    it('includes owner and admin and only the supervisors assigned to the site', async () => {
      users = [
        user(1, { role: 'OWNER' }),
        user(2, { role: 'ADMIN' }),
        user(3, { role: 'SUPERVISOR', siteIds: [SITE_1, SITE_2] }),
        user(4, { role: 'SUPERVISOR', siteIds: [SITE_2] }),
        user(5, { role: 'SUPERVISOR', siteIds: [] }),
      ];

      await expect(
        service.listRecipients(dto({ roles, siteId: SITE_1 })),
      ).resolves.toEqual({ userIds: [id(1), id(2), id(3)] });
    });

    it('excludes a supervisor of another site', async () => {
      users = [user(1, { role: 'SUPERVISOR', siteIds: [SITE_2] })];

      await expect(
        service.listRecipients(dto({ roles: ['supervisor'], siteId: SITE_1 })),
      ).resolves.toEqual({ userIds: [] });
    });

    it('excludes inactive supervisors, owners and admins', async () => {
      users = [
        user(1, { role: 'SUPERVISOR', siteIds: [SITE_1], isActive: false }),
        user(2, { role: 'OWNER', isActive: false }),
        user(3, { role: 'ADMIN', isActive: false }),
      ];

      await expect(
        service.listRecipients(dto({ roles, siteId: SITE_1 })),
      ).resolves.toEqual({ userIds: [] });
    });

    it('excludes users of other tenants even when assigned to the same site id', async () => {
      users = [
        user(1, { role: 'SUPERVISOR', siteIds: [SITE_1], tenantId: TENANT_B }),
        user(2, { role: 'ADMIN', tenantId: TENANT_B }),
      ];

      await expect(
        service.listRecipients(dto({ roles, siteId: SITE_1 })),
      ).resolves.toEqual({ userIds: [] });
    });

    it('does not return owner/admin when their role was not requested', async () => {
      users = [
        user(1, { role: 'OWNER' }),
        user(2, { role: 'ADMIN' }),
        user(3, { role: 'SUPERVISOR', siteIds: [SITE_1] }),
      ];

      await expect(
        service.listRecipients(dto({ roles: ['supervisor'], siteId: SITE_1 })),
      ).resolves.toEqual({ userIds: [id(3)] });
    });

    it('never returns employees: auth does not know their sites', async () => {
      users = [user(1, { role: 'EMPLOYEE', siteIds: [SITE_1] }), user(2)];

      await expect(
        service.listRecipients(dto({ roles: ['employee'], siteId: SITE_1 })),
      ).resolves.toEqual({ userIds: [] });
    });

    it('uses a "has" filter on siteIds together with the tenant', async () => {
      await service.listRecipients(dto({ roles, siteId: SITE_1 }));

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenantId: TENANT_A,
            isActive: true,
            OR: [
              { role: { in: ['OWNER', 'ADMIN'] } },
              { role: 'SUPERVISOR', siteIds: { has: SITE_1 } },
            ],
          },
        }),
      );
    });
  });
});
