import {
  EmailTakenException,
  EmployeeNotFoundException,
  ForbiddenException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { EmployeesService } from './employees.service';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER_ADMIN = '0199b7e0-0000-7000-8000-000000000001';
const USER_ANA = '0199b7e0-0000-7000-8000-000000000002';
const USER_BOB = '0199b7e0-0000-7000-8000-000000000003';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';
const SITE_B = '0199b7e0-0000-7000-8000-0000000000b1';

interface Row {
  id: string;
  tenantId: string;
  userId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarMediaId: string | null;
  employeeNumber: string | null;
  nationalId: string | null;
  skills: string[];
  weeklyHoursLimit: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  sites: { siteId: string; tenantId?: string }[];
}

type Where = Record<string, unknown>;

// Evaluates the subset of Prisma `where` the service builds.
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND') return (value as Where[]).every((w) => matches(row, w));
    if (key === 'OR') return (value as Where[]).some((w) => matches(row, w));
    if (key === 'sites') {
      const wanted = (value as { some: { siteId: string | { in: string[] } } })
        .some.siteId;
      return row.sites.some(({ siteId }) =>
        typeof wanted === 'string'
          ? siteId === wanted
          : wanted.in.includes(siteId),
      );
    }
    const field = (row as unknown as Where)[key];
    if (value !== null && typeof value === 'object' && 'contains' in value) {
      return String(field)
        .toLowerCase()
        .includes(
          String((value as { contains: string }).contains).toLowerCase(),
        );
    }
    return field === value;
  });
}

function employee(
  id: string,
  tenantId: string,
  overrides: Partial<Row> = {},
): Row {
  return {
    id,
    tenantId,
    userId: null,
    email: `${id}@example.com`,
    firstName: 'First',
    lastName: 'Last',
    phone: null,
    avatarMediaId: null,
    employeeNumber: null,
    nationalId: '30111222',
    skills: [],
    weeklyHoursLimit: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    sites: [],
    ...overrides,
  };
}

function actor(
  role: OrganizationActor['role'],
  overrides: Partial<OrganizationActor> = {},
): OrganizationActor {
  return { userId: USER_ADMIN, tenantId: TENANT_A, role, ...overrides };
}

function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('Expected the call to fail');
    },
    (error: unknown) => error,
  );
}

describe('EmployeesService', () => {
  let rows: Row[];
  let existingSites: string[];
  const publish = jest.fn();
  const findExistingSiteIds = jest.fn();
  const create = jest.fn();
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const updateMany = jest.fn();
  const deleteMany = jest.fn();
  const createMany = jest.fn();
  const prisma = {
    employee: { create, findFirst, findMany, count, updateMany },
    employeeSite: { deleteMany, createMany },
    $transaction: jest.fn(),
  };
  let service: EmployeesService;

  beforeEach(() => {
    jest.resetAllMocks();
    rows = [
      employee('e-ana', TENANT_A, {
        userId: USER_ANA,
        firstName: 'Ana',
        lastName: 'Alvarez',
        sites: [{ siteId: SITE_1 }],
      }),
      employee('e-bob', TENANT_A, {
        userId: USER_BOB,
        firstName: 'Bob',
        lastName: 'Benitez',
        sites: [{ siteId: SITE_2 }],
      }),
      employee('e-cat', TENANT_A, {
        firstName: 'Cat',
        lastName: 'Cruz',
        isActive: false,
      }),
      employee('e-other', TENANT_B, {
        firstName: 'Zed',
        lastName: 'Other',
        sites: [{ siteId: SITE_B }],
      }),
    ];
    existingSites = [SITE_1, SITE_2];
    findExistingSiteIds.mockImplementation((tenantId: string, ids: string[]) =>
      Promise.resolve(
        tenantId === TENANT_A
          ? ids.filter((i) => existingSites.includes(i))
          : [],
      ),
    );
    create.mockImplementation(
      ({
        data,
      }: {
        data: Partial<Row> & { sites: { create: { siteId: string }[] } };
      }) => {
        const { sites, ...rest } = data;
        const row = {
          ...employee('e-new', data.tenantId!),
          ...rest,
          sites: sites.create,
        };
        rows.push(row);
        return Promise.resolve(row);
      },
    );
    findFirst.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    );
    findMany.mockImplementation(
      ({ where, skip, take }: { where: Where; skip: number; take: number }) =>
        Promise.resolve(
          rows
            .filter((r) => matches(r, where))
            .sort((a, b) => a.lastName.localeCompare(b.lastName))
            .slice(skip, skip + take),
        ),
    );
    count.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.filter((r) => matches(r, where)).length),
    );
    updateMany.mockImplementation(
      ({ where, data }: { where: Where; data: Partial<Row> }) => {
        const hits = rows.filter((r) => matches(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hits.length });
      },
    );
    deleteMany.mockImplementation(
      ({ where }: { where: { employeeId: string; tenantId: string } }) => {
        const row = rows.find(
          (r) => r.id === where.employeeId && r.tenantId === where.tenantId,
        );
        if (row) row.sites = [];
        return Promise.resolve({ count: 0 });
      },
    );
    createMany.mockImplementation(
      ({ data }: { data: { employeeId: string; siteId: string }[] }) => {
        for (const item of data) {
          rows
            .find((r) => r.id === item.employeeId)!
            .sites.push({
              siteId: item.siteId,
            });
        }
        return Promise.resolve({ count: data.length });
      },
    );
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) =>
        Promise.resolve(callback(prisma)),
    );
    publish.mockResolvedValue(undefined);
    service = new EmployeesService(
      prisma as never,
      { publish } as never,
      { findExistingSiteIds } as never,
    );
  });

  describe('create', () => {
    const dto = {
      firstName: 'Dan',
      lastName: 'Diaz',
      email: '  Dan@Example.COM ',
      employeeNumber: 'L-1',
      nationalId: '28999888',
      skills: ['guard'],
      weeklyHoursLimit: 40,
      siteIds: [SITE_1],
    };

    it('stores the employee in the actor tenant with a normalized email and enabled sites, then emits employee_created', async () => {
      const view = await service.create(actor('admin'), dto);

      const data = create.mock.calls[0][0].data;
      expect(data).toEqual(
        expect.objectContaining({
          tenantId: TENANT_A,
          email: 'dan@example.com',
          employeeNumber: 'L-1',
          skills: ['guard'],
          weeklyHoursLimit: 40,
        }),
      );
      expect(data.sites.create).toEqual([
        { tenantId: TENANT_A, siteId: SITE_1 },
      ]);
      expect(view.siteIds).toEqual([SITE_1]);
      expect(publish).toHaveBeenCalledWith(TENANT_A, 'employee_created', {
        employeeId: 'e-new',
        tenantId: TENANT_A,
        email: 'dan@example.com',
        firstName: 'Dan',
        lastName: 'Diaz',
      });
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(
        publish.mock.invocationCallOrder[0],
      );
    });

    it('ignores a tenantId sent by the client: the tenant is the actor tenant', async () => {
      await service.create(actor('owner'), {
        ...dto,
        tenantId: TENANT_B,
      } as never);
      expect(create.mock.calls[0][0].data.tenantId).toBe(TENANT_A);
    });

    it('answers 409 email_taken on a unique violation (email or legajo) and emits nothing', async () => {
      create.mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      const error = await errorOf(service.create(actor('admin'), dto));
      expect(error).toBeInstanceOf(EmailTakenException);
      expect(publish).not.toHaveBeenCalled();
    });

    it('rethrows an unexpected database error', async () => {
      create.mockRejectedValueOnce(new Error('boom'));
      const error = await errorOf(service.create(actor('admin'), dto));
      expect(error).toEqual(new Error('boom'));
    });

    it('rejects enabled sites that do not exist in the tenant (422) and writes nothing', async () => {
      const error = await errorOf(
        service.create(actor('admin'), { ...dto, siteIds: [SITE_1, SITE_B] }),
      );
      expect(error).toBeInstanceOf(ValidationException);
      expect(findExistingSiteIds).toHaveBeenCalledWith(TENANT_A, [
        SITE_1,
        SITE_B,
      ]);
      expect(create).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it.each(['supervisor', 'employee'] as const)(
      'refuses %s with forbidden and writes nothing',
      async (role) => {
        const error = await errorOf(service.create(actor(role), dto));
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(create).not.toHaveBeenCalled();
        expect(publish).not.toHaveBeenCalled();
      },
    );

    it('refuses a platform admin (no tenant)', async () => {
      const error = await errorOf(
        service.create(actor('platform_admin', { tenantId: null }), dto),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates only the given fields in the actor tenant and replaces the enabled sites', async () => {
      const view = await service.update(actor('admin'), 'e-ana', {
        skills: ['first-aid'],
        weeklyHoursLimit: null,
        isActive: false,
        siteIds: [SITE_2],
      });

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: 'e-ana', tenantId: TENANT_A },
        data: {
          skills: ['first-aid'],
          weeklyHoursLimit: null,
          isActive: false,
        },
      });
      expect(deleteMany).toHaveBeenCalledWith({
        where: { employeeId: 'e-ana', tenantId: TENANT_A },
      });
      expect(createMany).toHaveBeenCalledWith({
        data: [{ tenantId: TENANT_A, employeeId: 'e-ana', siteId: SITE_2 }],
      });
      expect(view.siteIds).toEqual([SITE_2]);
      expect(view.isActive).toBe(false);
      expect(view.firstName).toBe('Ana');
    });

    it('leaves the sites alone when siteIds is not sent', async () => {
      await service.update(actor('owner'), 'e-ana', { phone: '555' });
      expect(deleteMany).not.toHaveBeenCalled();
      expect(createMany).not.toHaveBeenCalled();
    });

    it('answers 404 for an employee of another tenant and writes nothing', async () => {
      const error = await errorOf(
        service.update(actor('admin'), 'e-other', { phone: '555' }),
      );
      expect(error).toBeInstanceOf(EmployeeNotFoundException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('rejects sites outside the tenant', async () => {
      const error = await errorOf(
        service.update(actor('admin'), 'e-ana', { siteIds: [SITE_B] }),
      );
      expect(error).toBeInstanceOf(ValidationException);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('answers 409 email_taken when the legajo is already used', async () => {
      updateMany.mockRejectedValueOnce(
        Object.assign(new Error('unique'), { code: 'P2002' }),
      );
      const error = await errorOf(
        service.update(actor('admin'), 'e-ana', { employeeNumber: 'L-1' }),
      );
      expect(error).toBeInstanceOf(EmailTakenException);
    });

    it.each(['supervisor', 'employee'] as const)(
      'refuses %s with forbidden',
      async (role) => {
        const error = await errorOf(
          service.update(actor(role), 'e-ana', { phone: '555' }),
        );
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('get', () => {
    it('owner/admin read any employee of their tenant by id or by userId, including the national id', async () => {
      const byId = await service.get(actor('admin'), { employeeId: 'e-bob' });
      const byUser = await service.get(actor('owner'), { userId: USER_BOB });
      expect(byId.id).toBe('e-bob');
      expect(byUser.id).toBe('e-bob');
      expect(byId.nationalId).toBe('30111222');
    });

    it('tenant isolation: an employee of another tenant is a 404, even by userId', async () => {
      rows.push(employee('e-x', TENANT_B, { userId: USER_ANA + 'x' }));
      expect(
        await errorOf(service.get(actor('admin'), { employeeId: 'e-other' })),
      ).toBeInstanceOf(EmployeeNotFoundException);
      expect(
        await errorOf(service.get(actor('admin'), { userId: USER_ANA + 'x' })),
      ).toBeInstanceOf(EmployeeNotFoundException);
    });

    it('a supervisor sees an employee enabled in one of their sites, without the national id', async () => {
      const view = await service.get(
        actor('supervisor', { siteIds: [SITE_1] }),
        { employeeId: 'e-ana' },
      );
      expect(view.id).toBe('e-ana');
      expect(view).not.toHaveProperty('nationalId');
    });

    it('a supervisor gets 404 (never 403) for an employee outside their sites or without sites', async () => {
      const supervisor = actor('supervisor', { siteIds: [SITE_1] });
      for (const employeeId of ['e-bob', 'e-cat']) {
        expect(
          await errorOf(service.get(supervisor, { employeeId })),
        ).toBeInstanceOf(EmployeeNotFoundException);
      }
    });

    it('an employee sees only their own profile (with the national id) and gets 404 for others', async () => {
      const ana = actor('employee', { userId: USER_ANA });
      const own = await service.get(ana, { employeeId: 'e-ana' });
      expect(own.nationalId).toBe('30111222');
      expect(
        await errorOf(service.get(ana, { employeeId: 'e-bob' })),
      ).toBeInstanceOf(EmployeeNotFoundException);
      expect(
        await errorOf(service.get(ana, { userId: USER_BOB })),
      ).toBeInstanceOf(EmployeeNotFoundException);
    });

    it('refuses a platform admin', async () => {
      const error = await errorOf(
        service.get(actor('platform_admin', { tenantId: null }), {
          employeeId: 'e-ana',
        }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('getForTenant', () => {
    it('looks up by userId with the explicit tenant and no visibility rule', async () => {
      const view = await service.getForTenant(TENANT_A, { userId: USER_BOB });
      expect(view.id).toBe('e-bob');
      expect(view.siteIds).toEqual([SITE_2]);
    });

    it('does not cross tenants', async () => {
      const error = await errorOf(
        service.getForTenant(TENANT_B, { userId: USER_BOB }),
      );
      expect(error).toBeInstanceOf(EmployeeNotFoundException);
    });
  });

  describe('list', () => {
    it('owner/admin list the whole tenant and never another tenant', async () => {
      const result = await service.list(actor('admin'), {});
      expect(result.total).toBe(3);
      expect(result.items.map((i) => i.id)).toEqual([
        'e-ana',
        'e-bob',
        'e-cat',
      ]);
    });

    it('filters by site, active flag and search, and paginates', async () => {
      const admin = actor('admin');
      expect(
        (await service.list(admin, { siteId: SITE_2 })).items.map((i) => i.id),
      ).toEqual(['e-bob']);
      expect(
        (await service.list(admin, { isActive: false })).items.map((i) => i.id),
      ).toEqual(['e-cat']);
      expect(
        (await service.list(admin, { search: 'ALVAR' })).items.map((i) => i.id),
      ).toEqual(['e-ana']);
      const page = await service.list(admin, { page: 2, pageSize: 2 });
      expect(page.total).toBe(3);
      expect(page.items.map((i) => i.id)).toEqual(['e-cat']);
    });

    it('a supervisor lists only employees enabled in their sites, even when filtering by another site', async () => {
      const supervisor = actor('supervisor', { siteIds: [SITE_1] });
      expect(
        (await service.list(supervisor, {})).items.map((i) => i.id),
      ).toEqual(['e-ana']);
      expect(await service.list(supervisor, { siteId: SITE_2 })).toEqual({
        items: [],
        total: 0,
      });
    });

    it('a supervisor without sites sees nobody', async () => {
      const result = await service.list(actor('supervisor'), {});
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('an employee lists only themselves', async () => {
      const result = await service.list(
        actor('employee', { userId: USER_BOB }),
        {},
      );
      expect(result.items.map((i) => i.id)).toEqual(['e-bob']);
      expect(result.total).toBe(1);
    });

    it('refuses a platform admin', async () => {
      const error = await errorOf(
        service.list(actor('platform_admin', { tenantId: null }), {}),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });
});
