import {
  EmployeeNotFoundException,
  ForbiddenException,
  PostNotFoundException,
  ShiftTemplateNotFoundException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { ORGANIZATION_EVENTS } from '../organization.patterns';
import { ShiftGeneratorJob } from './shift-generator.job';
import { ShiftTemplatesService } from './shift-templates.service';

jest.mock('../../config', () => ({ envs: { shiftHorizonDays: 7 } }));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER_OWNER = '0199b7e0-0000-7000-8000-000000000001';
const USER_EMP = '0199b7e0-0000-7000-8000-000000000002';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';
const POST_1 = '0199b7e0-0000-7000-8000-0000000000c1';
const POST_OTHER_SITE = '0199b7e0-0000-7000-8000-0000000000c2';
const EMP_1 = '0199b7e0-0000-7000-8000-0000000000e1';
const EMP_INACTIVE = '0199b7e0-0000-7000-8000-0000000000e2';
const TPL_1 = '0199b7e0-0000-7000-8000-000000000101';

interface TemplateRow {
  id: string;
  tenantId: string;
  siteId: string;
  postId: string;
  employeeId: string | null;
  weekdays: number[];
  startTime: string;
  durationMinutes: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ShiftRow {
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
}

function actor(
  role: OrganizationActor['role'],
  overrides: Partial<OrganizationActor> = {},
): OrganizationActor {
  return { userId: USER_OWNER, tenantId: TENANT_A, role, ...overrides };
}

function buildContext() {
  const templates: TemplateRow[] = [];
  const shifts: ShiftRow[] = [];
  const suspendedTenants: string[] = [];
  let seq = 1;

  const sitesMap = new Map([
    [
      SITE_1,
      {
        id: SITE_1,
        tenantId: TENANT_A,
        timezone: 'America/Argentina/Buenos_Aires',
        isActive: true,
      },
    ],
    [
      SITE_2,
      {
        id: SITE_2,
        tenantId: TENANT_A,
        timezone: 'America/Argentina/Buenos_Aires',
        isActive: true,
      },
    ],
  ]);

  const postsMap = new Map([
    [
      POST_1,
      {
        id: POST_1,
        tenantId: TENANT_A,
        siteId: SITE_1,
        isActive: true,
      },
    ],
    [
      POST_OTHER_SITE,
      {
        id: POST_OTHER_SITE,
        tenantId: TENANT_A,
        siteId: SITE_2,
        isActive: true,
      },
    ],
  ]);

  const employeesMap = new Map([
    [EMP_1, { id: EMP_1, tenantId: TENANT_A, userId: USER_EMP, isActive: true }],
    [
      EMP_INACTIVE,
      { id: EMP_INACTIVE, tenantId: TENANT_A, userId: null, isActive: false },
    ],
  ]);

  const matchTemplate = (row: TemplateRow, where: Record<string, unknown>) => {
    if (where.AND && Array.isArray(where.AND)) {
      return (where.AND as Record<string, unknown>[]).every((clause) =>
        matchTemplate(row, clause),
      );
    }
    return Object.entries(where).every(([key, value]) => {
      const actual = (row as unknown as Record<string, unknown>)[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const op = value as { in?: unknown[]; notIn?: unknown[] };
        if (op.in) return op.in.includes(actual);
        if (op.notIn) return !op.notIn.includes(actual);
      }
      return actual === value;
    });
  };

  const prisma = {
    tenantState: {
      findMany: jest.fn(() =>
        Promise.resolve(suspendedTenants.map((tenantId) => ({ tenantId }))),
      ),
    },
    shiftTemplate: {
      create: jest.fn(({ data }: { data: Partial<TemplateRow> }) => {
        const created: TemplateRow = {
          id: `tpl-${seq++}`,
          tenantId: data.tenantId!,
          siteId: data.siteId!,
          postId: data.postId!,
          employeeId: data.employeeId ?? null,
          weekdays: data.weekdays ?? [],
          startTime: data.startTime!,
          durationMinutes: data.durationMinutes!,
          isActive: data.isActive ?? true,
          createdAt: new Date('2026-03-01T12:00:00Z'),
          updatedAt: new Date('2026-03-01T12:00:00Z'),
        };
        templates.push(created);
        return Promise.resolve({ ...created });
      }),
      findFirst: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          templates.find((row) => matchTemplate(row, where)) ?? null,
        ),
      ),
      findMany: jest.fn(
        ({
          where,
          include,
          skip = 0,
          take = 20,
        }: {
          where: Record<string, unknown>;
          include?: unknown;
          skip?: number;
          take?: number;
        }) => {
          const matched = templates
            .filter((row) => matchTemplate(row, where))
            .slice(skip, skip + take)
            .map((row) => {
              if (!include) return { ...row };
              return {
                ...row,
                site: sitesMap.get(row.siteId),
                post: postsMap.get(row.postId),
                employee: row.employeeId
                  ? (employeesMap.get(row.employeeId) ?? null)
                  : null,
              };
            });
          return Promise.resolve(matched);
        },
      ),
      count: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          templates.filter((row) => matchTemplate(row, where)).length,
        ),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<TemplateRow>;
        }) => {
          const found = templates.find((row) => row.id === where.id)!;
          Object.assign(found, data, { updatedAt: new Date('2026-03-02T12:00:00Z') });
          return Promise.resolve({ ...found });
        },
      ),
    },
    shift: {
      findMany: jest.fn(({ where }: { where: Record<string, unknown> }) => {
        const matched = shifts.filter((row) => {
          if (where.tenantId && row.tenantId !== where.tenantId) return false;
          if (where.templateId && row.templateId !== where.templateId) {
            return false;
          }
          if (where.employeeId && row.employeeId !== where.employeeId) {
            return false;
          }
          if (
            where.status &&
            typeof where.status === 'object' &&
            (where.status as { not?: string }).not === row.status
          ) {
            return false;
          }
          if (where.startsAt && typeof where.startsAt === 'object') {
            const cond = where.startsAt as { gte?: Date; lte?: Date; lt?: Date };
            if (cond.gte && row.startsAt < cond.gte) return false;
            if (cond.lte && row.startsAt > cond.lte) return false;
            if (cond.lt && row.startsAt >= cond.lt) return false;
          }
          if (where.endsAt && typeof where.endsAt === 'object') {
            const cond = where.endsAt as { gt?: Date };
            if (cond.gt && row.endsAt <= cond.gt) return false;
          }
          return true;
        });
        return Promise.resolve(matched.map((r) => ({ ...r })));
      }),
      create: jest.fn(({ data }: { data: Partial<ShiftRow> }) => {
        const duplicate = shifts.find(
          (row) =>
            row.tenantId === data.tenantId &&
            row.templateId === data.templateId &&
            row.startsAt.getTime() === data.startsAt!.getTime(),
        );
        if (duplicate) {
          return Promise.reject(Object.assign(new Error('dup'), { code: 'P2002' }));
        }
        const created: ShiftRow = {
          id: `shift-${seq++}`,
          tenantId: data.tenantId!,
          templateId: data.templateId ?? null,
          siteId: data.siteId!,
          postId: data.postId!,
          employeeId: data.employeeId ?? null,
          startsAt: data.startsAt!,
          endsAt: data.endsAt!,
          status: 'SCHEDULED',
          version: 1,
        };
        shifts.push(created);
        return Promise.resolve({ ...created });
      }),
    },
  };

  const sites = {
    getForTenant: jest.fn((tenantId: string, siteId: string) => {
      const site = sitesMap.get(siteId);
      if (!site || site.tenantId !== tenantId) {
        return Promise.reject(new Error('SiteNotFound'));
      }
      return Promise.resolve(site);
    }),
  };

  const posts = {
    getForTenant: jest.fn((tenantId: string, postId: string) => {
      const post = postsMap.get(postId);
      if (!post || post.tenantId !== tenantId) {
        return Promise.reject(new PostNotFoundException());
      }
      return Promise.resolve(post);
    }),
  };

  const employees = {
    getForTenant: jest.fn(
      (
        tenantId: string,
        selector: { employeeId?: string; userId?: string },
      ) => {
        const found = [...employeesMap.values()].find(
          (emp) =>
            emp.tenantId === tenantId &&
            (selector.employeeId
              ? emp.id === selector.employeeId
              : emp.userId === selector.userId),
        );
        if (!found) return Promise.reject(new EmployeeNotFoundException());
        return Promise.resolve(found);
      },
    ),
  };

  const events = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new ShiftTemplatesService(
    prisma as never,
    sites as never,
    posts as never,
    employees as never,
    events as never,
  );
  const job = new ShiftGeneratorJob(service);

  return {
    service,
    job,
    templates,
    shifts,
    suspendedTenants,
    sitesMap,
    postsMap,
    employeesMap,
    events,
    prisma,
  };
}

describe('ShiftTemplatesService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    // Monday 2026-03-09 10:00 Buenos Aires (13:00Z).
    jest.setSystemTime(new Date('2026-03-09T13:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a template and materializes shifts within the horizon skipping past start times', async () => {
    const ctx = buildContext();
    // Monday 09:00 already passed (now is 10:00), Wednesday 09:00 is upcoming in 7-day window.
    const result = await ctx.service.create(actor('owner'), {
      siteId: SITE_1,
      postId: POST_1,
      weekdays: [3, 1],
      startTime: '09:00',
      durationMinutes: 480,
      employeeId: EMP_1,
    });

    expect(result.template.weekdays).toEqual([1, 3]);
    expect(result.generatedCount).toBe(1);
    expect(result.skippedOverlapCount).toBe(0);
    expect(ctx.shifts).toHaveLength(1);
    expect(ctx.shifts[0].startsAt.toISOString()).toBe('2026-03-11T12:00:00.000Z');
    expect(ctx.events.publish).toHaveBeenCalledWith(
      TENANT_A,
      ORGANIZATION_EVENTS.shiftCreated,
      expect.objectContaining({ siteId: SITE_1, postId: POST_1, employeeId: EMP_1 }),
    );
  });

  it('rejects supervisor, employee and platform_admin mutations', async () => {
    const ctx = buildContext();
    for (const role of ['supervisor', 'employee', 'platform_admin'] as const) {
      await expect(
        ctx.service.create(
          actor(role, role === 'platform_admin' ? { tenantId: null } : {}),
          {
            siteId: SITE_1,
            postId: POST_1,
            weekdays: [1],
            startTime: '08:00',
            durationMinutes: 480,
          },
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  it('validates post belongs to site and entities are active', async () => {
    const ctx = buildContext();
    await expect(
      ctx.service.create(actor('admin'), {
        siteId: SITE_1,
        postId: POST_OTHER_SITE,
        weekdays: [1],
        startTime: '08:00',
        durationMinutes: 480,
      }),
    ).rejects.toBeInstanceOf(PostNotFoundException);

    await expect(
      ctx.service.create(actor('admin'), {
        siteId: SITE_1,
        postId: POST_1,
        weekdays: [1],
        startTime: '08:00',
        durationMinutes: 480,
        employeeId: EMP_INACTIVE,
      }),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('skips overlapping employee shifts during template generation', async () => {
    const ctx = buildContext();
    ctx.shifts.push({
      id: 'existing-shift',
      tenantId: TENANT_A,
      templateId: null,
      siteId: SITE_2,
      postId: POST_OTHER_SITE,
      employeeId: EMP_1,
      startsAt: new Date('2026-03-11T14:00:00.000Z'),
      endsAt: new Date('2026-03-11T22:00:00.000Z'),
      status: 'SCHEDULED',
      version: 1,
    });

    const result = await ctx.service.create(actor('owner'), {
      siteId: SITE_1,
      postId: POST_1,
      weekdays: [3],
      startTime: '12:00',
      durationMinutes: 480,
      employeeId: EMP_1,
    });

    expect(result.generatedCount).toBe(0);
    expect(result.skippedOverlapCount).toBe(1);
    expect(ctx.shifts).toHaveLength(1);
  });

  it('updates missing days without touching already generated slots and allows unassigning', async () => {
    const ctx = buildContext();
    const created = await ctx.service.create(actor('owner'), {
      siteId: SITE_1,
      postId: POST_1,
      weekdays: [3],
      startTime: '09:00',
      durationMinutes: 480,
      employeeId: EMP_1,
    });
    expect(created.generatedCount).toBe(1);

    const updated = await ctx.service.update(actor('admin'), created.template.id, {
      weekdays: [3, 5],
      employeeId: null,
    });
    expect(updated.generatedCount).toBe(1);
    expect(ctx.shifts).toHaveLength(2);
    expect(ctx.shifts[1].employeeId).toBeNull();
  });

  it('deactivates template idempotently and isolates across tenants', async () => {
    const ctx = buildContext();
    ctx.templates.push({
      id: TPL_1,
      tenantId: TENANT_A,
      siteId: SITE_1,
      postId: POST_1,
      employeeId: EMP_1,
      weekdays: [2],
      startTime: '08:00',
      durationMinutes: 480,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(
      ctx.service.deactivate(actor('owner', { tenantId: TENANT_B }), TPL_1),
    ).rejects.toBeInstanceOf(ShiftTemplateNotFoundException);

    const deactivated = await ctx.service.deactivate(actor('owner'), TPL_1);
    expect(deactivated.isActive).toBe(false);
    const again = await ctx.service.deactivate(actor('owner'), TPL_1);
    expect(again.isActive).toBe(false);
  });

  it('filters list for supervisor by siteIds and for employee by own profile', async () => {
    const ctx = buildContext();
    ctx.templates.push(
      {
        id: 't-site1',
        tenantId: TENANT_A,
        siteId: SITE_1,
        postId: POST_1,
        employeeId: EMP_1,
        weekdays: [1],
        startTime: '08:00',
        durationMinutes: 480,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 't-site2',
        tenantId: TENANT_A,
        siteId: SITE_2,
        postId: POST_OTHER_SITE,
        employeeId: null,
        weekdays: [2],
        startTime: '09:00',
        durationMinutes: 480,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );

    const supList = await ctx.service.list(
      actor('supervisor', { siteIds: [SITE_1] }),
      {},
    );
    expect(supList.items.map((i) => i.id)).toEqual(['t-site1']);

    const supOutOfScope = await ctx.service.list(
      actor('supervisor', { siteIds: [SITE_1] }),
      { siteId: SITE_2 },
    );
    expect(supOutOfScope.items).toEqual([]);

    const empList = await ctx.service.list(
      actor('employee', { userId: USER_EMP }),
      {},
    );
    expect(empList.items.map((i) => i.id)).toEqual(['t-site1']);
  });

  it('daily job skips suspended tenants and turns inactive employees into unassigned shifts', async () => {
    const ctx = buildContext();
    ctx.templates.push(
      {
        id: 't-suspended',
        tenantId: TENANT_B,
        siteId: SITE_1,
        postId: POST_1,
        employeeId: null,
        weekdays: [3],
        startTime: '08:00',
        durationMinutes: 480,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      {
        id: 't-inactive-emp',
        tenantId: TENANT_A,
        siteId: SITE_1,
        postId: POST_1,
        employeeId: EMP_INACTIVE,
        weekdays: [3],
        startTime: '10:00',
        durationMinutes: 480,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    );
    ctx.suspendedTenants.push(TENANT_B);

    const summary = await ctx.job.tick(new Date('2026-03-09T13:00:00.000Z'));
    expect(summary.templatesProcessed).toBe(1);
    expect(summary.generatedCount).toBe(1);
    expect(ctx.shifts).toHaveLength(1);
    expect(ctx.shifts[0].employeeId).toBeNull();
  });
});
