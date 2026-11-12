import { ArgumentsHost } from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import {
  EmployeeNotFoundException,
  ShiftNotFoundException,
  SiteNotFoundException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import { NatsErrorFilter } from '../../common/filters/nats-exception.filter';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { ORGANIZATION_PATTERNS } from '../organization.patterns';
import type { OrganizationService } from '../organization.service';
import { OrganizationResponder } from './organization.responder';
import {
  EmployeeGetRequestDto,
  ShiftGetRequestDto,
  SiteGetRequestDto,
} from './responder.dto';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER = '0199b7e0-0000-7000-8000-000000000001';
const EMPLOYEE = '0199b7e0-0000-7000-8000-000000000002';
const SITE = '0199b7e0-0000-7000-8000-0000000000a1';
const POST = '0199b7e0-0000-7000-8000-0000000000c1';
const SHIFT = '0199b7e0-0000-7000-8000-0000000000d1';

const SITE_ROW = {
  id: SITE,
  tenantId: TENANT_A,
  name: 'HQ',
  address: 'Calle 1',
  latitude: -34.6,
  longitude: -58.4,
  geofenceRadiusMeters: 150,
  timezone: 'America/Argentina/Buenos_Aires',
  qrCode: 'qr-secret',
  qrRotatedAt: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const EMPLOYEE_VIEW = {
  id: EMPLOYEE,
  tenantId: TENANT_A,
  userId: USER,
  email: 'ana@example.com',
  firstName: 'Ana',
  lastName: 'Lopez',
  phone: '+5411',
  avatarMediaId: null,
  employeeNumber: '7',
  nationalId: '123',
  skills: [],
  weeklyHoursLimit: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  siteIds: [SITE],
};

const SHIFT_VIEW = {
  id: SHIFT,
  tenantId: TENANT_A,
  templateId: null,
  siteId: SITE,
  postId: POST,
  employeeId: EMPLOYEE as string | null,
  startsAt: new Date('2026-11-02T08:00:00.000Z'),
  endsAt: new Date('2026-11-02T16:00:00.000Z'),
  status: 'SCHEDULED' as string,
  version: 3,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function pattern(method: keyof OrganizationResponder) {
  return Reflect.getMetadata(
    'microservices:pattern',
    Object.getOwnPropertyDescriptor(OrganizationResponder.prototype, method)
      ?.value as object,
  ) as unknown[];
}

// What the caller receives for a thrown error (responder-side filter).
async function wireError(error: unknown) {
  const result = new NatsErrorFilter().catch(error, {} as ArgumentsHost);
  return firstValueFrom(result).catch((e: unknown) => e);
}

describe('OrganizationResponder', () => {
  const getSiteForTenant = jest.fn();
  const getEmployeeForTenant = jest.fn();
  const getShiftForTenant = jest.fn();
  const responder = new OrganizationResponder({
    getSiteForTenant,
    getEmployeeForTenant,
    getShiftForTenant,
  } as unknown as OrganizationService);

  beforeEach(() => jest.clearAllMocks());

  it('answers the three patterns telemetry calls', () => {
    expect(pattern('getSite')).toEqual([ORGANIZATION_PATTERNS.siteGet]);
    expect(pattern('getEmployee')).toEqual([ORGANIZATION_PATTERNS.employeeGet]);
    expect(pattern('getShift')).toEqual([ORGANIZATION_PATTERNS.shiftGet]);
  });

  describe('organization.site.get', () => {
    it('maps geofenceRadiusMeters to radiusMeters and keeps the QR code', async () => {
      getSiteForTenant.mockResolvedValue(SITE_ROW);

      await expect(
        responder.getSite({ tenantId: TENANT_A, siteId: SITE }),
      ).resolves.toEqual({
        id: SITE,
        tenantId: TENANT_A,
        name: 'HQ',
        latitude: -34.6,
        longitude: -58.4,
        radiusMeters: 150,
        qrCode: 'qr-secret',
      });
      expect(getSiteForTenant).toHaveBeenCalledWith(TENANT_A, SITE);
    });

    it('answers 404 site_not_found, also for a site of another tenant', async () => {
      getSiteForTenant.mockImplementation((tenantId: string) =>
        tenantId === TENANT_A
          ? Promise.resolve(SITE_ROW)
          : Promise.reject(new SiteNotFoundException()),
      );
      const error = await responder
        .getSite({ tenantId: TENANT_B, siteId: SITE })
        .catch((e: unknown) => e);

      expect(await wireError(error)).toEqual({
        status: 404,
        code: 'site_not_found',
        message: 'Site not found',
      });
    });
  });

  describe('organization.employee.get', () => {
    it('looks up by userId and returns only identity and name', async () => {
      getEmployeeForTenant.mockResolvedValue(EMPLOYEE_VIEW);

      const result = await responder.getEmployee({
        tenantId: TENANT_A,
        userId: USER,
      });

      expect(result).toEqual({
        id: EMPLOYEE,
        userId: USER,
        tenantId: TENANT_A,
        firstName: 'Ana',
        lastName: 'Lopez',
      });
      expect(getEmployeeForTenant).toHaveBeenCalledWith(TENANT_A, {
        userId: USER,
      });
      expect(JSON.stringify(result)).not.toContain('ana@example.com');
    });

    it('answers 404 employee_not_found', async () => {
      getEmployeeForTenant.mockRejectedValue(new EmployeeNotFoundException());
      const error = await responder
        .getEmployee({ tenantId: TENANT_B, userId: USER })
        .catch((e: unknown) => e);

      expect(await wireError(error)).toEqual({
        status: 404,
        code: 'employee_not_found',
        message: 'Employee not found',
      });
    });
  });

  describe('organization.shift.get', () => {
    it('serializes dates and keeps the status and version', async () => {
      getShiftForTenant.mockResolvedValue(SHIFT_VIEW);

      await expect(
        responder.getShift({ tenantId: TENANT_A, shiftId: SHIFT }),
      ).resolves.toEqual({
        id: SHIFT,
        tenantId: TENANT_A,
        siteId: SITE,
        postId: POST,
        employeeId: EMPLOYEE,
        startsAt: '2026-11-02T08:00:00.000Z',
        endsAt: '2026-11-02T16:00:00.000Z',
        status: 'SCHEDULED',
        version: 3,
      });
      expect(getShiftForTenant).toHaveBeenCalledWith(TENANT_A, SHIFT);
    });

    it('maps FINISHED to COMPLETED', async () => {
      getShiftForTenant.mockResolvedValue({
        ...SHIFT_VIEW,
        status: 'FINISHED',
      });

      const result = await responder.getShift({
        tenantId: TENANT_A,
        shiftId: SHIFT,
      });

      expect(result.status).toBe('COMPLETED');
    });

    it('omits employeeId of an unassigned shift', async () => {
      getShiftForTenant.mockResolvedValue({ ...SHIFT_VIEW, employeeId: null });

      const result = await responder.getShift({
        tenantId: TENANT_A,
        shiftId: SHIFT,
      });

      expect(result).not.toHaveProperty('employeeId');
    });

    it('answers 404 shift_not_found', async () => {
      getShiftForTenant.mockRejectedValue(new ShiftNotFoundException());
      const error = await responder
        .getShift({ tenantId: TENANT_B, shiftId: SHIFT })
        .catch((e: unknown) => e);

      expect(await wireError(error)).toEqual({
        status: 404,
        code: 'shift_not_found',
        message: 'Shift not found',
      });
    });
  });

  it('does not leak the message of an unexpected error', async () => {
    getShiftForTenant.mockRejectedValue(new Error('connection to db:5432'));
    const error = await responder
      .getShift({ tenantId: TENANT_A, shiftId: SHIFT })
      .catch((e: unknown) => e);

    expect(await wireError(error)).toEqual({
      status: 500,
      code: 'internal_error',
      message: 'Internal server error',
    });
  });

  describe('payload validation', () => {
    const pipe = createValidationPipe();
    const meta = (metatype: new () => object) =>
      ({ type: 'body', metatype }) as const;

    it('rejects a missing, malformed or extra field before the facade', async () => {
      await expect(
        pipe.transform({ tenantId: TENANT_A }, meta(SiteGetRequestDto)),
      ).rejects.toBeInstanceOf(ValidationException);
      await expect(
        pipe.transform(
          { tenantId: 'nope', userId: USER },
          meta(EmployeeGetRequestDto),
        ),
      ).rejects.toBeInstanceOf(ValidationException);
      await expect(
        pipe.transform(
          { tenantId: TENANT_A, shiftId: SHIFT, actor: 'x' },
          meta(ShiftGetRequestDto),
        ),
      ).rejects.toBeInstanceOf(ValidationException);
      expect(getSiteForTenant).not.toHaveBeenCalled();
    });

    it('accepts the exact telemetry payload', async () => {
      await expect(
        pipe.transform(
          { tenantId: TENANT_A, userId: USER },
          meta(EmployeeGetRequestDto),
        ),
      ).resolves.toMatchObject({ tenantId: TENANT_A, userId: USER });
    });
  });
});
