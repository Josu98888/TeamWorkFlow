// Loads reflect-metadata, which class-transformer's @Type needs.
import '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CancelShiftBodyDto,
  CreateShiftBodyDto,
  ListShiftsQueryDto,
  ReassignShiftBodyDto,
  UpdateShiftBodyDto,
} from './dto/shift.dto';
import { ShiftsController } from './shifts.controller';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const SHIFT_ID = '0199b7e0-0000-7000-8000-0000000000d1';
const SITE_ID = '0199b7e0-0000-7000-8000-0000000000a1';
const POST_ID = '0199b7e0-0000-7000-8000-0000000000c1';
const EMPLOYEE_ID = '0199b7e0-0000-7000-8000-0000000000e1';
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

describe('ShiftsController', () => {
  const shifts = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    reassign: jest.fn(),
    cancel: jest.fn(),
  };
  const controller = new ShiftsController(shifts as never);

  beforeEach(() => jest.clearAllMocks());

  it('passes only the documented actor fields plus the validated input', async () => {
    const body = { version: 1 };
    const params = { shiftId: SHIFT_ID };
    await controller.create(VERIFIED as never, body as never);
    await controller.update(VERIFIED as never, params, body as never);
    await controller.reassign(VERIFIED as never, params, {
      version: 1,
      employeeId: null,
    });
    await controller.cancel(VERIFIED as never, params, body);
    await controller.get(VERIFIED as never, params);
    await controller.list(VERIFIED as never, {});

    expect(shifts.create).toHaveBeenCalledWith(ORG_ACTOR, body);
    expect(shifts.update).toHaveBeenCalledWith(ORG_ACTOR, SHIFT_ID, body);
    expect(shifts.reassign).toHaveBeenCalledWith(ORG_ACTOR, SHIFT_ID, {
      version: 1,
      employeeId: null,
    });
    expect(shifts.cancel).toHaveBeenCalledWith(ORG_ACTOR, SHIFT_ID, body);
    expect(shifts.get).toHaveBeenCalledWith(ORG_ACTOR, SHIFT_ID);
    expect(shifts.list).toHaveBeenCalledWith(ORG_ACTOR, {});
  });

  describe('DTO validation', () => {
    const valid = {
      siteId: SITE_ID,
      postId: POST_ID,
      startsAt: '2026-03-10T12:00:00Z',
      endsAt: '2026-03-10T20:00:00-03:00',
    };

    it('accepts a valid create body, with or without employee', async () => {
      expect(await errorsOf(CreateShiftBodyDto, valid)).toEqual([]);
      expect(
        await errorsOf(CreateShiftBodyDto, {
          ...valid,
          employeeId: EMPLOYEE_ID,
        }),
      ).toEqual([]);
    });

    it('rejects a client-sent tenantId, a bare local time and a bad uuid', async () => {
      expect(
        await errorsOf(CreateShiftBodyDto, { ...valid, tenantId: 'x' }),
      ).toEqual(['tenantId']);
      expect(
        await errorsOf(CreateShiftBodyDto, {
          ...valid,
          startsAt: '2026-03-10T12:00:00',
        }),
      ).toEqual(['startsAt']);
      expect(
        await errorsOf(CreateShiftBodyDto, { ...valid, siteId: 'nope' }),
      ).toEqual(['siteId']);
    });

    it('requires a positive integer version on update, reassign and cancel', async () => {
      expect(await errorsOf(UpdateShiftBodyDto, {})).toEqual(['version']);
      expect(await errorsOf(UpdateShiftBodyDto, { version: 0 })).toEqual([
        'version',
      ]);
      expect(await errorsOf(CancelShiftBodyDto, { version: 1.5 })).toEqual([
        'version',
      ]);
      expect(await errorsOf(UpdateShiftBodyDto, { version: 2 })).toEqual([]);
    });

    it('does not accept employee or site changes through update', async () => {
      expect(
        await errorsOf(UpdateShiftBodyDto, {
          version: 1,
          employeeId: EMPLOYEE_ID,
        }),
      ).toEqual(['employeeId']);
      expect(
        await errorsOf(UpdateShiftBodyDto, { version: 1, siteId: SITE_ID }),
      ).toEqual(['siteId']);
    });

    it('reassign requires the employeeId field, null unassigns', async () => {
      expect(await errorsOf(ReassignShiftBodyDto, { version: 1 })).toEqual([
        'employeeId',
      ]);
      expect(
        await errorsOf(ReassignShiftBodyDto, { version: 1, employeeId: null }),
      ).toEqual([]);
      expect(
        await errorsOf(ReassignShiftBodyDto, {
          version: 1,
          employeeId: EMPLOYEE_ID,
        }),
      ).toEqual([]);
      expect(
        await errorsOf(ReassignShiftBodyDto, { version: 1, employeeId: 'x' }),
      ).toEqual(['employeeId']);
    });

    it('validates the list query', async () => {
      expect(
        await errorsOf(ListShiftsQueryDto, {
          siteId: SITE_ID,
          day: '2026-03-10',
          page: '2',
        }),
      ).toEqual([]);
      expect(await errorsOf(ListShiftsQueryDto, { day: '10/03/2026' })).toEqual(
        ['day'],
      );
    });
  });
});
