import {
  ForbiddenException,
  SiteNotFoundException,
} from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { SitesService } from './sites.service';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER = '0199b7e0-0000-7000-8000-000000000001';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';
const SITE_B = '0199b7e0-0000-7000-8000-0000000000b1';

interface Row {
  id: string;
  tenantId: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  geofenceRadiusMeters: number;
  timezone: string;
  qrCode: string;
  qrRotatedAt: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Where {
  id?: string | { in: string[] };
  tenantId: string;
}

function matches(row: Row, where: Where) {
  const idOk =
    where.id === undefined ||
    (typeof where.id === 'string'
      ? row.id === where.id
      : where.id.in.includes(row.id));
  return idOk && row.tenantId === where.tenantId;
}

function site(id: string, tenantId: string, name: string): Row {
  return {
    id,
    tenantId,
    name,
    address: 'Main St 1',
    latitude: -34.6,
    longitude: -58.4,
    geofenceRadiusMeters: 100,
    timezone: 'America/Argentina/Buenos_Aires',
    qrCode: `qr-${id}`,
    qrRotatedAt: null,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function actor(
  role: OrganizationActor['role'],
  overrides: Partial<OrganizationActor> = {},
): OrganizationActor {
  return { userId: USER, tenantId: TENANT_A, role, ...overrides };
}

function errorOf(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('Expected the call to fail');
    },
    (error: unknown) => error,
  );
}

describe('SitesService', () => {
  let rows: Row[];
  const publish = jest.fn();
  const create = jest.fn();
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const updateMany = jest.fn();
  const prisma = { site: { create, findFirst, findMany, count, updateMany } };
  let service: SitesService;

  beforeEach(() => {
    jest.resetAllMocks();
    rows = [
      site(SITE_1, TENANT_A, 'Alpha'),
      site(SITE_2, TENANT_A, 'Beta'),
      site(SITE_B, TENANT_B, 'Other tenant'),
    ];
    create.mockImplementation(({ data }: { data: Partial<Row> }) => {
      const row = { ...site('new-site', data.tenantId!, ''), ...data };
      rows.push(row);
      return Promise.resolve(row);
    });
    findFirst.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    );
    findMany.mockImplementation(
      ({ where, skip, take }: { where: Where; skip: number; take: number }) =>
        Promise.resolve(
          rows.filter((r) => matches(r, where)).slice(skip, skip + take),
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
    publish.mockResolvedValue(undefined);
    service = new SitesService(
      prisma as never,
      { publish } as never,
    );
  });

  describe('create', () => {
    const dto = {
      name: 'HQ',
      address: 'Av 1',
      latitude: -34.6,
      longitude: -58.4,
      geofenceRadiusMeters: 150,
      timezone: 'America/Argentina/Buenos_Aires',
    };

    it('stores the site in the actor tenant with a generated qr and emits site_updated after the write', async () => {
      const view = await service.create(actor('admin'), dto);

      expect(create.mock.calls[0][0].data).toEqual(
        expect.objectContaining({ tenantId: TENANT_A, name: 'HQ' }),
      );
      expect(typeof create.mock.calls[0][0].data.qrCode).toBe('string');
      expect(create.mock.calls[0][0].data.qrCode.length).toBeGreaterThanOrEqual(
        32,
      );
      expect(view.qrCode).toBe(create.mock.calls[0][0].data.qrCode);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        'site_updated',
        expect.objectContaining({
          siteId: 'new-site',
          tenantId: TENANT_A,
          latitude: -34.6,
          longitude: -58.4,
          geofenceRadiusMeters: 150,
          qrRotated: false,
        }),
      );
      expect(create.mock.invocationCallOrder[0]).toBeLessThan(
        publish.mock.invocationCallOrder[0],
      );
    });

    it('generates a different qr for every site', async () => {
      await service.create(actor('owner'), dto);
      await service.create(actor('owner'), dto);
      expect(create.mock.calls[0][0].data.qrCode).not.toBe(
        create.mock.calls[1][0].data.qrCode,
      );
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
        service.create(
          actor('platform_admin', { tenantId: null }),
          dto,
        ),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('update', () => {
    it('updates only the given fields, filters by tenant and emits site_updated', async () => {
      const view = await service.update(actor('owner'), SITE_1, {
        geofenceRadiusMeters: 250,
        isActive: false,
      });

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: SITE_1, tenantId: TENANT_A },
        data: { geofenceRadiusMeters: 250, isActive: false },
      });
      expect(view.isActive).toBe(false);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        'site_updated',
        expect.objectContaining({
          siteId: SITE_1,
          geofenceRadiusMeters: 250,
          qrRotated: false,
        }),
      );
    });

    it('does not touch the database or emit when nothing changes', async () => {
      await service.update(actor('admin'), SITE_1, {});
      expect(updateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it('answers 404 for a site of another tenant', async () => {
      const error = await errorOf(
        service.update(actor('admin'), SITE_B, { name: 'x' }),
      );
      expect(error).toBeInstanceOf(SiteNotFoundException);
      expect(updateMany).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    });

    it.each(['supervisor', 'employee'] as const)(
      'refuses %s with forbidden',
      async (role) => {
        const error = await errorOf(
          service.update(actor(role, { siteIds: [SITE_1] }), SITE_1, {
            name: 'x',
          }),
        );
        expect(error).toBeInstanceOf(ForbiddenException);
      },
    );
  });

  describe('get', () => {
    it('returns the site with qrCode to owner and admin', async () => {
      const view = await service.get(actor('owner'), SITE_1);
      expect(view.qrCode).toBe(`qr-${SITE_1}`);
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: SITE_1, tenantId: TENANT_A },
      });
    });

    it('does not find a site of another tenant (tenant isolation)', async () => {
      const error = await errorOf(service.get(actor('owner'), SITE_B));
      expect(error).toBeInstanceOf(SiteNotFoundException);
      expect((error as SiteNotFoundException).getError()).toEqual(
        expect.objectContaining({ status: 404, code: 'site_not_found' }),
      );
    });

    it('lets a supervisor read a site in siteIds, with qrCode', async () => {
      const view = await service.get(
        actor('supervisor', { siteIds: [SITE_1] }),
        SITE_1,
      );
      expect(view.id).toBe(SITE_1);
      expect(view.qrCode).toBeDefined();
    });

    it('answers 404 (not 403) for a supervisor outside siteIds', async () => {
      const error = await errorOf(
        service.get(actor('supervisor', { siteIds: [SITE_1] }), SITE_2),
      );
      expect(error).toBeInstanceOf(SiteNotFoundException);
      expect(findFirst).not.toHaveBeenCalled();
    });

    it('answers 404 to an employee so site ids cannot be probed', async () => {
      const error = await errorOf(service.get(actor('employee'), SITE_1));
      expect(error).toBeInstanceOf(SiteNotFoundException);
    });

    it('refuses a platform admin', async () => {
      const error = await errorOf(
        service.get(actor('platform_admin', { tenantId: null }), SITE_1),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('list', () => {
    it('lists every site of the tenant only', async () => {
      const result = await service.list(actor('admin'), {});
      expect(result.total).toBe(2);
      expect(result.items.map((s) => s.id)).toEqual([SITE_1, SITE_2]);
      expect(findMany.mock.calls[0][0].where).toEqual({ tenantId: TENANT_A });
    });

    it('paginates', async () => {
      const result = await service.list(actor('admin'), {
        page: 2,
        pageSize: 1,
      });
      expect(result.total).toBe(2);
      expect(result.items.map((s) => s.id)).toEqual([SITE_2]);
    });

    it('limits a supervisor to siteIds', async () => {
      const result = await service.list(
        actor('supervisor', { siteIds: [SITE_2] }),
        {},
      );
      expect(result.items.map((s) => s.id)).toEqual([SITE_2]);
      expect(result.total).toBe(1);
      expect(findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT_A,
        id: { in: [SITE_2] },
      });
    });

    it('returns nothing to a supervisor without sites', async () => {
      const result = await service.list(actor('supervisor'), {});
      expect(result).toEqual({ items: [], total: 0 });
    });

    it('returns an empty page to an employee and never queries', async () => {
      const result = await service.list(actor('employee'), {});
      expect(result).toEqual({ items: [], total: 0 });
      expect(findMany).not.toHaveBeenCalled();
    });

    it('never returns qrCode to an employee actor even if rows were read', async () => {
      // Defense in depth: the view strips the qr for an employee.
      const view = (
        service as unknown as {
          toView: (a: unknown, s: Row) => Record<string, unknown>;
        }
      ).toView({ ...actor('employee'), tenantId: TENANT_A }, rows[0]);
      expect('qrCode' in view).toBe(false);
    });

    it('refuses a platform admin', async () => {
      const error = await errorOf(
        service.list(actor('platform_admin', { tenantId: null }), {}),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('rotateQr', () => {
    it('replaces the qr, sets qrRotatedAt and emits site_updated with qrRotated', async () => {
      const before = rows[0].qrCode;
      const view = await service.rotateQr(actor('owner'), SITE_1);

      expect(view.qrCode).toBeDefined();
      expect(view.qrCode).not.toBe(before);
      expect(rows[0].qrCode).toBe(view.qrCode);
      expect(view.qrRotatedAt).toBeInstanceOf(Date);
      expect(publish).toHaveBeenCalledWith(
        TENANT_A,
        'site_updated',
        expect.objectContaining({ siteId: SITE_1, qrRotated: true }),
      );
    });

    it('rotates to a different value every time', async () => {
      const first = (await service.rotateQr(actor('admin'), SITE_1)).qrCode;
      const second = (await service.rotateQr(actor('admin'), SITE_1)).qrCode;
      expect(first).not.toBe(second);
    });

    it.each(['supervisor', 'employee'] as const)(
      'refuses %s with forbidden',
      async (role) => {
        const error = await errorOf(
          service.rotateQr(actor(role, { siteIds: [SITE_1] }), SITE_1),
        );
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(updateMany).not.toHaveBeenCalled();
      },
    );

    it('cannot rotate the qr of a site of another tenant', async () => {
      const before = rows[2].qrCode;
      const error = await errorOf(service.rotateQr(actor('owner'), SITE_B));
      expect(error).toBeInstanceOf(SiteNotFoundException);
      expect(rows[2].qrCode).toBe(before);
      expect(publish).not.toHaveBeenCalled();
    });
  });
});
