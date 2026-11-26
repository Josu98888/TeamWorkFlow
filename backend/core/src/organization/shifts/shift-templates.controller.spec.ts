import '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreateShiftTemplateBodyDto,
  ListShiftTemplatesQueryDto,
  ShiftTemplateIdParamDto,
  UpdateShiftTemplateBodyDto,
} from './dto/shift-template.dto';
import { ShiftTemplatesController } from './shift-templates.controller';

jest.mock('../../config', () => ({ envs: {} }));
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const SITE_ID = '0199b7e0-0000-7000-8000-0000000000a1';
const POST_ID = '0199b7e0-0000-7000-8000-0000000000c1';
const EMP_ID = '0199b7e0-0000-7000-8000-0000000000e1';
const TPL_ID = '0199b7e0-0000-7000-8000-000000000101';
const VERIFIED = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-00000000000a',
  role: 'owner' as const,
  tenantStatus: 'active',
  plan: 'pro',
  features: { tasks: true },
};
const ORG_ACTOR = {
  userId: VERIFIED.userId,
  tenantId: VERIFIED.tenantId,
  role: 'owner',
};

describe('ShiftTemplatesController', () => {
  const service = {
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    list: jest.fn(),
  };
  const controller = new ShiftTemplatesController(service as never);

  beforeEach(() => jest.clearAllMocks());

  it('forwards sanitized actor and validated inputs to service methods', async () => {
    const createBody = {
      siteId: SITE_ID,
      postId: POST_ID,
      weekdays: [1, 3, 5],
      startTime: '08:00',
      durationMinutes: 480,
      employeeId: EMP_ID,
    };
    const updateBody = { weekdays: [2, 4], employeeId: null };

    await controller.create(VERIFIED as never, createBody);
    await controller.update(
      VERIFIED as never,
      { templateId: TPL_ID },
      updateBody,
    );
    await controller.deactivate(VERIFIED as never, { templateId: TPL_ID });
    await controller.list(VERIFIED as never, { siteId: SITE_ID, isActive: true });

    expect(service.create).toHaveBeenCalledWith(ORG_ACTOR, createBody);
    expect(service.update).toHaveBeenCalledWith(ORG_ACTOR, TPL_ID, updateBody);
    expect(service.deactivate).toHaveBeenCalledWith(ORG_ACTOR, TPL_ID);
    expect(service.list).toHaveBeenCalledWith(ORG_ACTOR, {
      siteId: SITE_ID,
      isActive: true,
    });
  });
});

describe('shift-template DTOs', () => {
  const valid = {
    siteId: SITE_ID,
    postId: POST_ID,
    weekdays: [1, 2, 3, 4, 5],
    startTime: '08:30',
    durationMinutes: 480,
    employeeId: EMP_ID,
  };

  async function errors(cls: new () => object, plain: object) {
    const result = await validate(plainToInstance(cls, plain) as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return result.map((e) => e.property);
  }

  it('accepts valid create and update payloads', async () => {
    expect(await errors(CreateShiftTemplateBodyDto, valid)).toEqual([]);
    expect(
      await errors(CreateShiftTemplateBodyDto, { ...valid, employeeId: null }),
    ).toEqual([]);
    expect(
      await errors(UpdateShiftTemplateBodyDto, { employeeId: null, isActive: false }),
    ).toEqual([]);
    expect(await errors(ShiftTemplateIdParamDto, { templateId: TPL_ID })).toEqual([]);
  });

  it('rejects out-of-range weekdays, invalid startTime and duration', async () => {
    expect(
      await errors(CreateShiftTemplateBodyDto, { ...valid, weekdays: [0, 8] }),
    ).toEqual(['weekdays']);
    expect(
      await errors(CreateShiftTemplateBodyDto, { ...valid, weekdays: [] }),
    ).toEqual(['weekdays']);
    expect(
      await errors(CreateShiftTemplateBodyDto, { ...valid, startTime: '25:00' }),
    ).toEqual(['startTime']);
    expect(
      await errors(CreateShiftTemplateBodyDto, {
        ...valid,
        durationMinutes: 1441,
      }),
    ).toEqual(['durationMinutes']);
  });

  it('transforms isActive boolean query strings', async () => {
    const dto = plainToInstance(ListShiftTemplatesQueryDto, {
      siteId: SITE_ID,
      isActive: 'false',
    });
    expect(dto.isActive).toBe(false);
    const result = await validate(dto, { whitelist: true });
    expect(result).toEqual([]);
  });
});
