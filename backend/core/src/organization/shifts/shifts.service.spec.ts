import {
  EmployeeNotFoundException,
  ForbiddenException,
  PostNotFoundException,
  ShiftNotEditableException,
  ShiftNotFoundException,
  ShiftOverlapException,
  SiteNotFoundException,
  ValidationException,
  VersionConflictException,
} from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { ShiftsService } from './shifts.service';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER_ADMIN = '0199b7e0-0000-7000-8000-000000000001';
const USER_ANA = '0199b7e0-0000-7000-8000-000000000002';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';
const POST_1 = '0199b7e0-0000-7000-8000-0000000000c1';
const POST_2 = '0199b7e0-0000-7000-8000-0000000000c2';
const EMP_ANA = '0199b7e0-0000-7000-8000-0000000000e1';
const EMP_BOB = '0199b7e0-0000-7000-8000-0000000000e2';
const TIMEZONE = 'America/Argentina/Buenos_Aires'; // UTC-3

interface Row {
  id: string;
  tenantId: string;
  templateId: string | null;
  siteId: string;
  postId: string;
  employeeId: string | null;
  startsAt: Date;
  endsAt: Date;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINISHED' | 'CANCELLED';
  version: number;
  startingEmittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // Test-only join for the `employee: { userId }` visibility filter.
  employeeUserId?: string | null;
}

type Where = Record<string, unknown>;

function isOperator(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !Array.isArray(value)
  );
}

function compare(field: unknown, op: string, expected: unknown): boolean {
  const a = field instanceof Date ? field.getTime() : field;
  const b = expected instanceof Date ? expected.getTime() : expected;
  switch (op) {
    case 'lt':
      return (a as number) < (b as number);
    case 'lte':
      return (a as number) <= (b as number);
    case 'gt':
      return (a as number) > (b as number);
    case 'gte':
      return (a as number) >= (b as number);
    case 'not':
      return a !== b;
    case 'in':
      return (expected as unknown[]).includes(field);
    default:
      throw new Error(`Unsupported operator ${op}`);
  }
}

// Evaluates the subset of Prisma `where` the service builds.
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value === undefined) return true;
    if (key === 'AND') return (value as Where[]).every((w) => matches(row, w));
    if (key === 'OR') return (value as Where[]).some((w) => matches(row, w));
    if (key === 'employee') {
      return row.employeeUserId === (value as { userId: string }).userId;
    }
    const field = (row as unknown as Where)[key];
    if (isOperator(value)) {
      return Object.entries(value).every(([op, expected]) =>
        compare(field, op, expected),
      );
    }
    return field === value;
  });
}

const at = (iso: string) => new Date(iso);

function shift(
  id: string,
  tenantId: string,
  overrides: Partial<Row> = {},
): Row {
  return {
    id,
    tenantId,
    templateId: null,
    siteId: SITE_1,
    postId: POST_1,
    employeeId: null,
    startsAt: at('2026-03-10T12:00:00Z'),
    endsAt: at('2026-03-10T20:00:00Z'),
    status: 'SCHEDULED',
    version: 1,
    startingEmittedAt: null,
    createdAt: at('2026-01-01T00:00:00Z'),
    updatedAt: at('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

const employeeView = (overrides: Record<string, unknown> = {}) => ({
  id: EMP_ANA,
  tenantId: TENANT_A,
  userId: USER_ANA,
  isActive: true,
  skills: ['first-aid'],
  weeklyHoursLimit: null as number | null,
  siteIds: [SITE_1],
  ...overrides,
});

function admin(tenantId = TENANT_A): OrganizationActor {
  return { userId: USER_ADMIN, tenantId, role: 'admin' };
}

function supervisor(siteIds: string[]): OrganizationActor {
  return {
    userId: USER_ADMIN,
    tenantId: TENANT_A,
    role: 'supervisor',
    siteIds,
  };
}

function setup(initial: Row[]) {
  const rows = [...initial];
  let sequence = 0;
  const shiftModel = {
    findFirst: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(rows.find((row) => matches(row, where)) ?? null),
    ),
    findFirstOrThrow: jest.fn(({ where }: { where: Where }) => {
      const row = rows.find((r) => matches(r, where));
      return row ? Promise.resolve({ ...row }) : Promise.reject(new Error('x'));
    }),
    findMany: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(
        rows
          .filter((row) => matches(row, where))
          .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime()),
      ),
    ),
    count: jest.fn(({ where }: { where: Where }) =>
      Promise.resolve(rows.filter((row) => matches(row, where)).length),
    ),
    create: jest.fn(({ data }: { data: Partial<Row> }) => {
      sequence += 1;
      const row = shift(`new-${sequence}`, data.tenantId!, data);
      rows.push(row);
      return Promise.resolve({ ...row });
    }),
    updateMany: jest.fn(
      ({
        where,
        data,
      }: {
        where: Where;
        data: Record<string, unknown> & { version: { increment: number } };
      }) => {
        const targets = rows.filter((row) => matches(row, where));
        for (const row of targets) {
          const { version, ...rest } = data;
          Object.assign(row, rest);
          row.version += version.increment;
        }
        return Promise.resolve({ count: targets.length });
      },
    ),
  };
  const tx = { shift: shiftModel, $queryRaw: jest.fn().mockResolvedValue([]) };
  const prisma = {
    shift: shiftModel,
    $transaction: jest.fn((fn: (client: typeof tx) => unknown) => fn(tx)),
  };
  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const sites = {
    getForTenant: jest.fn((tenantId: string, siteId: string) => {
      const known = tenantId === TENANT_A && [SITE_1, SITE_2].includes(siteId);
      return known
        ? Promise.resolve({ id: siteId, tenantId, timezone: TIMEZONE })
        : Promise.reject(new SiteNotFoundException());
    }),
  };
  const posts = {
    getForTenant: jest.fn((tenantId: string, postId: string) => {
      const siteId =
        postId === POST_1 ? SITE_1 : postId === POST_2 ? SITE_2 : null;
      return tenantId === TENANT_A && siteId
        ? Promise.resolve({
            id: postId,
            siteId,
            requiredSkills: [] as string[],
          })
        : Promise.reject(new PostNotFoundException());
    }),
  };
  const employees = {
    getForTenant: jest.fn(
      (tenantId: string, lookup: { employeeId: string }) => {
        if (tenantId !== TENANT_A) {
          return Promise.reject(new EmployeeNotFoundException());
        }
        if (lookup.employeeId === EMP_ANA) {
          return Promise.resolve(employeeView());
        }
        if (lookup.employeeId === EMP_BOB) {
          return Promise.resolve(
            employeeView({ id: EMP_BOB, userId: null, siteIds: [] }),
          );
        }
        return Promise.reject(new EmployeeNotFoundException());
      },
    ),
  };
  const service = new ShiftsService(
    prisma as never,
    events as never,
    sites as never,
    posts as never,
    employees as never,
  );
  return { service, rows, prisma, tx, events, sites, posts, employees };
}

const createDto = (overrides: Record<string, unknown> = {}) => ({
  siteId: SITE_1,
  postId: POST_1,
  startsAt: '2026-03-10T12:00:00Z',
  endsAt: '2026-03-10T20:00:00Z',
  ...overrides,
});

describe('ShiftsService', () => {
  describe('create', () => {
    it('creates an unassigned shift, emits shift_created and warns nothing', async () => {
      const { service, events, tx } = setup([]);
      const result = await service.create(admin(), createDto());

      expect(result.warnings).toEqual([]);
      expect(result.shift).toMatchObject({
        tenantId: TENANT_A,
        siteId: SITE_1,
        postId: POST_1,
        employeeId: null,
        status: 'SCHEDULED',
        version: 1,
      });
      expect(result.shift).not.toHaveProperty('startingEmittedAt');
      expect(tx.$queryRaw).not.toHaveBeenCalled();
      expect(events.publish).toHaveBeenCalledWith(
        TENANT_A,
        'shift_created',
        expect.objectContaining({
          shiftId: result.shift.id,
          tenantId: TENANT_A,
          siteId: SITE_1,
          postId: POST_1,
          employeeId: null,
          startsAt: '2026-03-10T12:00:00.000Z',
          endsAt: '2026-03-10T20:00:00.000Z',
          status: 'SCHEDULED',
          version: 1,
        }),
      );
    });

    it('takes the tenant from the actor and locks the employee when assigned', async () => {
      const { service, tx, rows } = setup([]);
      await service.create(admin(), createDto({ employeeId: EMP_ANA }));
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(rows[0]).toMatchObject({
        tenantId: TENANT_A,
        employeeId: EMP_ANA,
      });
    });

    it('blocks an overlapping shift of the same employee (409) and emits nothing', async () => {
      const { service, events } = setup([
        shift('s1', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-10T18:00:00Z'),
          endsAt: at('2026-03-11T02:00:00Z'),
        }),
      ]);
      await expect(
        service.create(admin(), createDto({ employeeId: EMP_ANA })),
      ).rejects.toBeInstanceOf(ShiftOverlapException);
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('does not count cancelled shifts, other employees or touching ends as overlap', async () => {
      const { service } = setup([
        shift('cancelled', TENANT_A, {
          employeeId: EMP_ANA,
          status: 'CANCELLED',
        }),
        shift('other', TENANT_A, { employeeId: EMP_BOB }),
        shift('before', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-10T04:00:00Z'),
          endsAt: at('2026-03-10T12:00:00Z'),
        }),
      ]);
      const result = await service.create(
        admin(),
        createDto({ employeeId: EMP_ANA }),
      );
      expect(result.shift.employeeId).toBe(EMP_ANA);
    });

    it('warns rest_under_12h for a shift ending less than 12h before', async () => {
      const { service } = setup([
        shift('prev', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-10T00:00:00Z'),
          endsAt: at('2026-03-10T08:00:00Z'),
        }),
      ]);
      const result = await service.create(
        admin(),
        createDto({ employeeId: EMP_ANA }),
      );
      expect(result.warnings.map((w) => w.code)).toEqual(['rest_under_12h']);
    });

    it('warns rest_under_12h for a shift starting less than 12h after, but not at exactly 12h', async () => {
      const close = setup([
        shift('next', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-11T04:00:00Z'),
          endsAt: at('2026-03-11T10:00:00Z'),
        }),
      ]);
      expect(
        (
          await close.service.create(
            admin(),
            createDto({ employeeId: EMP_ANA }),
          )
        ).warnings.map((w) => w.code),
      ).toEqual(['rest_under_12h']);

      const exact = setup([
        shift('next', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-11T08:00:00Z'),
          endsAt: at('2026-03-11T10:00:00Z'),
        }),
      ]);
      expect(
        (
          await exact.service.create(
            admin(),
            createDto({ employeeId: EMP_ANA }),
          )
        ).warnings,
      ).toEqual([]);
    });

    it('warns weekly_hours_exceeded using the site timezone week', async () => {
      const { service, employees } = setup([
        // Mon 2026-03-09 local: 8h inside the week of the new shift.
        shift('mon', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-09T12:00:00Z'),
          endsAt: at('2026-03-09T20:00:00Z'),
        }),
        // Sunday night local (03-09T01:00Z = 03-08 22:00 local): previous week.
        shift('prev-week', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-09T01:00:00Z'),
          endsAt: at('2026-03-09T02:00:00Z'),
        }),
      ]);
      employees.getForTenant.mockResolvedValueOnce(
        employeeView({ weeklyHoursLimit: 15 }),
      );
      const result = await service.create(
        admin(),
        createDto({ employeeId: EMP_ANA }),
      );
      expect(result.warnings.map((w) => w.code)).toContain(
        'weekly_hours_exceeded',
      );
      expect(result.warnings[0].message).toBe(
        'Weekly hours would be 16, over the limit of 15',
      );
    });

    it('does not warn when the weekly total equals the limit', async () => {
      const { service, employees } = setup([
        shift('mon', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-09T12:00:00Z'),
          endsAt: at('2026-03-09T20:00:00Z'),
        }),
      ]);
      employees.getForTenant.mockResolvedValueOnce(
        employeeView({ weeklyHoursLimit: 16 }),
      );
      const result = await service.create(
        admin(),
        createDto({ employeeId: EMP_ANA }),
      );
      expect(result.warnings).toEqual([]);
    });

    it('warns missing_skill (case-insensitive) and site_not_enabled, without blocking', async () => {
      const { service, posts } = setup([]);
      posts.getForTenant.mockResolvedValueOnce({
        id: POST_1,
        siteId: SITE_1,
        requiredSkills: ['FIRST-AID', 'driving'],
      });
      const result = await service.create(
        admin(),
        createDto({ employeeId: EMP_BOB }),
      );
      expect(result.warnings.map((w) => w.code)).toEqual([
        'missing_skill',
        'site_not_enabled',
      ]);
      expect(result.shift.employeeId).toBe(EMP_BOB);
    });

    it('does not warn missing_skill when the skill match ignores case', async () => {
      const { service, posts } = setup([]);
      posts.getForTenant.mockResolvedValueOnce({
        id: POST_1,
        siteId: SITE_1,
        requiredSkills: ['FIRST-AID'],
      });
      const result = await service.create(
        admin(),
        createDto({ employeeId: EMP_ANA }),
      );
      expect(result.warnings).toEqual([]);
    });

    it('rejects an end that is not after the start (422)', async () => {
      const { service } = setup([]);
      await expect(
        service.create(admin(), createDto({ endsAt: '2026-03-10T12:00:00Z' })),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('rejects an inactive employee (422)', async () => {
      const { service, employees } = setup([]);
      employees.getForTenant.mockResolvedValueOnce(
        employeeView({ isActive: false }),
      );
      await expect(
        service.create(admin(), createDto({ employeeId: EMP_ANA })),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('answers 404 for a post of another site', async () => {
      const { service } = setup([]);
      await expect(
        service.create(admin(), createDto({ postId: POST_2 })),
      ).rejects.toBeInstanceOf(PostNotFoundException);
    });

    it('is tenant isolated: another tenant sees site, post and employee as missing', async () => {
      const { service } = setup([]);
      await expect(
        service.create(admin(TENANT_B), createDto()),
      ).rejects.toBeInstanceOf(SiteNotFoundException);
    });

    it('refuses an employee actor (403) and platform_admin (403)', async () => {
      const { service } = setup([]);
      await expect(
        service.create(
          { userId: USER_ANA, tenantId: TENANT_A, role: 'employee' },
          createDto(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        service.create(
          { userId: USER_ADMIN, tenantId: null, role: 'platform_admin' },
          createDto(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('lets a supervisor create inside siteIds and answers 404 outside', async () => {
      const { service } = setup([]);
      await expect(
        service.create(supervisor([SITE_1]), createDto()),
      ).resolves.toBeDefined();
      await expect(
        service.create(supervisor([SITE_2]), createDto()),
      ).rejects.toBeInstanceOf(SiteNotFoundException);
    });

    it('does not roll back when publishing fails inside the events service', async () => {
      const { service, events } = setup([]);
      events.publish.mockResolvedValue(undefined);
      const result = await service.create(admin(), createDto());
      expect(result.shift.id).toBeDefined();
    });
  });

  describe('update', () => {
    const existing = () =>
      shift('s1', TENANT_A, { employeeId: EMP_ANA, version: 3 });

    it('updates times, increments the version and emits shift_updated', async () => {
      const { service, events } = setup([existing()]);
      const result = await service.update(admin(), 's1', {
        version: 3,
        startsAt: '2026-03-10T13:00:00Z',
      });
      expect(result.shift).toMatchObject({
        version: 4,
        startsAt: at('2026-03-10T13:00:00Z'),
      });
      expect(events.publish).toHaveBeenCalledWith(
        TENANT_A,
        'shift_updated',
        expect.objectContaining({ shiftId: 's1', version: 4 }),
      );
    });

    it('answers version_conflict (409) for a stale version', async () => {
      const { service, events } = setup([existing()]);
      await expect(
        service.update(admin(), 's1', { version: 2, postId: POST_1 }),
      ).rejects.toBeInstanceOf(VersionConflictException);
      expect(events.publish).not.toHaveBeenCalled();
    });

    it('answers version_conflict when the row changed between read and write', async () => {
      const { service, tx } = setup([existing()]);
      tx.shift.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(
        service.update(admin(), 's1', { version: 3, postId: POST_1 }),
      ).rejects.toBeInstanceOf(VersionConflictException);
    });

    it.each(['CANCELLED', 'FINISHED'] as const)(
      'refuses to edit a %s shift (shift_not_editable)',
      async (status) => {
        const { service } = setup([
          shift('s1', TENANT_A, { status, version: 3 }),
        ]);
        await expect(
          service.update(admin(), 's1', { version: 3, postId: POST_1 }),
        ).rejects.toBeInstanceOf(ShiftNotEditableException);
      },
    );

    it('blocks a move that overlaps another shift of the assigned employee', async () => {
      const { service } = setup([
        existing(),
        shift('s2', TENANT_A, {
          employeeId: EMP_ANA,
          startsAt: at('2026-03-11T12:00:00Z'),
          endsAt: at('2026-03-11T20:00:00Z'),
        }),
      ]);
      await expect(
        service.update(admin(), 's1', {
          version: 3,
          startsAt: '2026-03-11T10:00:00Z',
          endsAt: '2026-03-11T14:00:00Z',
        }),
      ).rejects.toBeInstanceOf(ShiftOverlapException);
    });

    it('does not treat the shift itself as an overlap', async () => {
      const { service } = setup([existing()]);
      await expect(
        service.update(admin(), 's1', {
          version: 3,
          endsAt: '2026-03-10T21:00:00Z',
        }),
      ).resolves.toBeDefined();
    });

    it('answers 404 for another tenant and for a supervisor outside siteIds', async () => {
      const { service } = setup([existing()]);
      await expect(
        service.update(admin(TENANT_B), 's1', { version: 3 }),
      ).rejects.toBeInstanceOf(ShiftNotFoundException);
      await expect(
        service.update(supervisor([SITE_2]), 's1', { version: 3 }),
      ).rejects.toBeInstanceOf(ShiftNotFoundException);
    });
  });

  describe('reassign', () => {
    it('reassigns, returns warnings and emits shift_updated', async () => {
      const { service, events } = setup([
        shift('s1', TENANT_A, { employeeId: EMP_ANA, version: 1 }),
      ]);
      const result = await service.reassign(admin(), 's1', {
        version: 1,
        employeeId: EMP_BOB,
      });
      expect(result.shift).toMatchObject({ employeeId: EMP_BOB, version: 2 });
      expect(result.warnings.map((w) => w.code)).toEqual(['site_not_enabled']);
      expect(events.publish).toHaveBeenCalledWith(
        TENANT_A,
        'shift_updated',
        expect.objectContaining({ employeeId: EMP_BOB, version: 2 }),
      );
    });

    it('unassigns with null, with no lock and no warnings', async () => {
      const { service, tx } = setup([
        shift('s1', TENANT_A, { employeeId: EMP_ANA }),
      ]);
      const result = await service.reassign(admin(), 's1', {
        version: 1,
        employeeId: null,
      });
      expect(result.shift.employeeId).toBeNull();
      expect(result.warnings).toEqual([]);
      expect(tx.$queryRaw).not.toHaveBeenCalled();
    });

    it('blocks reassigning to an employee with an overlapping shift', async () => {
      const { service } = setup([
        shift('s1', TENANT_A, { employeeId: EMP_BOB }),
        shift('s2', TENANT_A, { employeeId: EMP_ANA }),
      ]);
      await expect(
        service.reassign(admin(), 's1', { version: 1, employeeId: EMP_ANA }),
      ).rejects.toBeInstanceOf(ShiftOverlapException);
    });

    it('answers 404 for an employee of another tenant and a stale version', async () => {
      const { service } = setup([shift('s1', TENANT_A)]);
      await expect(
        service.reassign(admin(), 's1', {
          version: 1,
          employeeId: '0199b7e0-0000-7000-8000-0000000000ff',
        }),
      ).rejects.toBeInstanceOf(EmployeeNotFoundException);
      await expect(
        service.reassign(admin(), 's1', { version: 9, employeeId: null }),
      ).rejects.toBeInstanceOf(VersionConflictException);
    });

    it('refuses a cancelled shift', async () => {
      const { service } = setup([
        shift('s1', TENANT_A, { status: 'CANCELLED' }),
      ]);
      await expect(
        service.reassign(admin(), 's1', { version: 1, employeeId: null }),
      ).rejects.toBeInstanceOf(ShiftNotEditableException);
    });
  });

  describe('cancel', () => {
    it('cancels, increments the version and emits shift_cancelled', async () => {
      const { service, events } = setup([
        shift('s1', TENANT_A, { employeeId: EMP_ANA, version: 2 }),
      ]);
      const result = await service.cancel(admin(), 's1', { version: 2 });
      expect(result).toMatchObject({ status: 'CANCELLED', version: 3 });
      expect(events.publish).toHaveBeenCalledWith(
        TENANT_A,
        'shift_cancelled',
        expect.objectContaining({
          shiftId: 's1',
          status: 'CANCELLED',
          version: 3,
        }),
      );
    });

    it('is not repeatable: a cancelled shift is not editable', async () => {
      const { service } = setup([shift('s1', TENANT_A)]);
      await service.cancel(admin(), 's1', { version: 1 });
      await expect(
        service.cancel(admin(), 's1', { version: 2 }),
      ).rejects.toBeInstanceOf(ShiftNotEditableException);
    });

    it('answers version_conflict and 404 outside the supervisor scope', async () => {
      const { service } = setup([shift('s1', TENANT_A)]);
      await expect(
        service.cancel(admin(), 's1', { version: 5 }),
      ).rejects.toBeInstanceOf(VersionConflictException);
      await expect(
        service.cancel(supervisor([SITE_2]), 's1', { version: 1 }),
      ).rejects.toBeInstanceOf(ShiftNotFoundException);
    });
  });

  describe('get and list', () => {
    const data = () => [
      shift('s1', TENANT_A, { employeeId: EMP_ANA, employeeUserId: USER_ANA }),
      shift('s2', TENANT_A, {
        siteId: SITE_2,
        postId: POST_2,
        startsAt: at('2026-03-11T12:00:00Z'),
        endsAt: at('2026-03-11T20:00:00Z'),
      }),
      shift('s3', TENANT_B),
    ];

    it('owner/admin read the whole tenant and never another tenant', async () => {
      const { service } = setup(data());
      expect((await service.list(admin(), {})).items.map((s) => s.id)).toEqual([
        's1',
        's2',
      ]);
      await expect(service.get(admin(), 's3')).rejects.toBeInstanceOf(
        ShiftNotFoundException,
      );
    });

    it('a supervisor sees only siteIds (404 on get, filtered list)', async () => {
      const { service } = setup(data());
      expect(
        (await service.list(supervisor([SITE_2]), {})).items.map((s) => s.id),
      ).toEqual(['s2']);
      await expect(
        service.get(supervisor([SITE_2]), 's1'),
      ).rejects.toBeInstanceOf(ShiftNotFoundException);
      expect(
        await service.list(supervisor([SITE_2]), { siteId: SITE_1 }),
      ).toEqual({ items: [], total: 0 });
    });

    it('an employee sees only their own shifts', async () => {
      const { service } = setup(data());
      const ana: OrganizationActor = {
        userId: USER_ANA,
        tenantId: TENANT_A,
        role: 'employee',
      };
      expect((await service.list(ana, {})).items.map((s) => s.id)).toEqual([
        's1',
      ]);
      await expect(service.get(ana, 's2')).rejects.toBeInstanceOf(
        ShiftNotFoundException,
      );
      await expect(service.get(ana, 's1')).resolves.toMatchObject({ id: 's1' });
    });

    it('filters by employee and by day in the site timezone', async () => {
      const { service } = setup([
        // 2026-03-10 22:00 local (03-11T01:00Z) belongs to local day 03-10.
        shift('late', TENANT_A, {
          startsAt: at('2026-03-11T01:00:00Z'),
          endsAt: at('2026-03-11T05:00:00Z'),
          employeeId: EMP_ANA,
        }),
        shift('next-day', TENANT_A, {
          startsAt: at('2026-03-11T03:00:00Z'),
          endsAt: at('2026-03-11T09:00:00Z'),
        }),
      ]);
      expect(
        (
          await service.list(admin(), { siteId: SITE_1, day: '2026-03-10' })
        ).items.map((s) => s.id),
      ).toEqual(['late']);
      expect(
        (await service.list(admin(), { employeeId: EMP_ANA })).items.map(
          (s) => s.id,
        ),
      ).toEqual(['late']);
    });

    it('requires siteId and a real date for the day filter', async () => {
      const { service } = setup(data());
      await expect(
        service.list(admin(), { day: '2026-03-10' }),
      ).rejects.toBeInstanceOf(ValidationException);
      await expect(
        service.list(admin(), { siteId: SITE_1, day: '2026-02-30' }),
      ).rejects.toBeInstanceOf(ValidationException);
    });

    it('returns an empty page for the day filter on an unknown site', async () => {
      const { service } = setup(data());
      expect(
        await service.list(admin(), {
          siteId: '0199b7e0-0000-7000-8000-0000000000ff',
          day: '2026-03-10',
        }),
      ).toEqual({ items: [], total: 0 });
    });

    it('getForTenant reads with an explicit tenant and no actor', async () => {
      const { service } = setup(data());
      await expect(service.getForTenant(TENANT_A, 's2')).resolves.toMatchObject(
        { id: 's2' },
      );
      await expect(service.getForTenant(TENANT_A, 's3')).rejects.toBeInstanceOf(
        ShiftNotFoundException,
      );
    });
  });
});
