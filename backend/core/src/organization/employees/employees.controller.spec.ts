// Loads reflect-metadata, which class-transformer's @Type needs.
import '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateEmployeeBodyDto,
  ListEmployeesQueryDto,
  UpdateEmployeeBodyDto,
} from './dto/employee.dto';
import { EmployeesController } from './employees.controller';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const EMPLOYEE_ID = '0199b7e0-0000-7000-8000-0000000000e1';
const SITE_ID = '0199b7e0-0000-7000-8000-0000000000a1';
const VERIFIED = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-00000000000a',
  role: 'supervisor' as const,
  siteIds: [SITE_ID],
  tenantStatus: 'active',
  plan: 'pro',
  features: { tasks: true },
};
const ORG_ACTOR = {
  userId: VERIFIED.userId,
  tenantId: VERIFIED.tenantId,
  role: 'supervisor',
  siteIds: [SITE_ID],
};

async function errorsOf<T extends object>(cls: new () => T, plain: object) {
  const errors = await validate(plainToInstance(cls, plain), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

describe('EmployeesController', () => {
  const employees = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
  };
  const controller = new EmployeesController(employees as never);

  beforeEach(() => jest.clearAllMocks());

  it('passes only the documented actor fields plus the validated input', async () => {
    const body = { firstName: 'x' };
    await controller.create(VERIFIED as never, body as never);
    await controller.update(
      VERIFIED as never,
      { employeeId: EMPLOYEE_ID },
      body,
    );
    await controller.get(VERIFIED as never, { employeeId: EMPLOYEE_ID });
    await controller.list(VERIFIED as never, { page: 2 });

    expect(employees.create).toHaveBeenCalledWith(ORG_ACTOR, body);
    expect(employees.update).toHaveBeenCalledWith(ORG_ACTOR, EMPLOYEE_ID, body);
    expect(employees.get).toHaveBeenCalledWith(ORG_ACTOR, {
      employeeId: EMPLOYEE_ID,
    });
    expect(employees.list).toHaveBeenCalledWith(ORG_ACTOR, { page: 2 });
  });

  describe('DTO validation', () => {
    const valid = {
      firstName: 'Dan',
      lastName: 'Diaz',
      email: 'dan@example.com',
    };

    it('accepts a minimal and a full create body', async () => {
      expect(await errorsOf(CreateEmployeeBodyDto, valid)).toEqual([]);
      expect(
        await errorsOf(CreateEmployeeBodyDto, {
          ...valid,
          phone: '555',
          employeeNumber: 'L-1',
          nationalId: '28999888',
          skills: ['guard'],
          weeklyHoursLimit: 40,
          siteIds: [SITE_ID],
        }),
      ).toEqual([]);
    });

    it.each([
      ['a bad email', { email: 'nope' }],
      ['a tenantId (not whitelisted)', { tenantId: SITE_ID }],
      ['an out-of-range weekly limit', { weeklyHoursLimit: 500 }],
      ['non-uuid site ids', { siteIds: ['x'] }],
      ['duplicate skills', { skills: ['a', 'a'] }],
    ])('rejects %s on create', async (_label, extra) => {
      expect(
        (await errorsOf(CreateEmployeeBodyDto, { ...valid, ...extra })).length,
      ).toBeGreaterThan(0);
    });

    it('update allows clearing nullable fields but not required ones, and has no email', async () => {
      expect(
        await errorsOf(UpdateEmployeeBodyDto, {
          phone: null,
          employeeNumber: null,
          weeklyHoursLimit: null,
          isActive: false,
          siteIds: [],
        }),
      ).toEqual([]);
      expect(
        (await errorsOf(UpdateEmployeeBodyDto, { firstName: null })).length,
      ).toBeGreaterThan(0);
      expect(
        (await errorsOf(UpdateEmployeeBodyDto, { email: 'a@b.com' })).length,
      ).toBeGreaterThan(0);
    });

    it('list query parses isActive and paging from strings', async () => {
      const query = plainToInstance(ListEmployeesQueryDto, {
        isActive: 'false',
        page: '2',
        pageSize: '10',
        siteId: SITE_ID,
        search: 'ana',
      });
      expect(await validate(query)).toEqual([]);
      expect(query.isActive).toBe(false);
      expect(query.page).toBe(2);
    });
  });
});
