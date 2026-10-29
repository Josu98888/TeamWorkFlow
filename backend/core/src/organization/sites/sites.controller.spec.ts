// Loads reflect-metadata, which class-transformer's @Type needs.
import '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CreatePostBodyDto,
  CreateSiteBodyDto,
  PageQueryDto,
  UpdateSiteBodyDto,
} from './dto/site.dto';
import { SitesController } from './sites.controller';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const SITE_ID = '0199b7e0-0000-7000-8000-0000000000a1';
const POST_ID = '0199b7e0-0000-7000-8000-0000000000c1';
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

describe('SitesController', () => {
  const sites = {
    create: jest.fn(),
    list: jest.fn(),
    get: jest.fn(),
    update: jest.fn(),
    rotateQr: jest.fn(),
  };
  const posts = { create: jest.fn(), list: jest.fn(), update: jest.fn() };
  const controller = new SitesController(sites as never, posts as never);

  beforeEach(() => jest.clearAllMocks());

  it('passes only the documented actor fields plus the validated input', async () => {
    const body = { name: 'x' };
    await controller.update(VERIFIED as never, { siteId: SITE_ID }, body);
    await controller.get(VERIFIED as never, { siteId: SITE_ID });
    await controller.rotateQr(VERIFIED as never, { siteId: SITE_ID });
    await controller.list(VERIFIED as never, { page: 2 });
    await controller.createPost(VERIFIED as never, { siteId: SITE_ID }, body);
    await controller.updatePost(VERIFIED as never, { postId: POST_ID }, body);
    await controller.listPosts(VERIFIED as never, { siteId: SITE_ID }, {});

    expect(sites.update).toHaveBeenCalledWith(ORG_ACTOR, SITE_ID, body);
    expect(sites.get).toHaveBeenCalledWith(ORG_ACTOR, SITE_ID);
    expect(sites.rotateQr).toHaveBeenCalledWith(ORG_ACTOR, SITE_ID);
    expect(sites.list).toHaveBeenCalledWith(ORG_ACTOR, { page: 2 });
    expect(posts.create).toHaveBeenCalledWith(ORG_ACTOR, SITE_ID, body);
    expect(posts.update).toHaveBeenCalledWith(ORG_ACTOR, POST_ID, body);
    expect(posts.list).toHaveBeenCalledWith(ORG_ACTOR, SITE_ID, {});
  });
});

describe('site DTOs', () => {
  const valid = {
    name: 'HQ',
    address: 'Av 1',
    latitude: -34.6,
    longitude: -58.4,
    geofenceRadiusMeters: 100,
    timezone: 'America/Argentina/Buenos_Aires',
  };

  async function errors(cls: new () => object, plain: object) {
    const result = await validate(plainToInstance(cls, plain) as object, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    return result.map((e) => e.property);
  }

  it('accepts a valid site and IANA zones including UTC', async () => {
    expect(await errors(CreateSiteBodyDto, valid)).toEqual([]);
    expect(
      await errors(CreateSiteBodyDto, { ...valid, timezone: 'UTC' }),
    ).toEqual([]);
  });

  it.each(['Mars/Olympus', '', '+01:00', 'not a zone'])(
    'rejects timezone %p',
    async (timezone) => {
      expect(await errors(CreateSiteBodyDto, { ...valid, timezone })).toEqual([
        'timezone',
      ]);
    },
  );

  it('rejects out-of-range coordinates and radius', async () => {
    expect(
      await errors(CreateSiteBodyDto, {
        ...valid,
        latitude: 91,
        longitude: -181,
        geofenceRadiusMeters: 0,
      }),
    ).toEqual(['latitude', 'longitude', 'geofenceRadiusMeters']);
  });

  it('rejects client-supplied tenantId and qrCode (forbidNonWhitelisted)', async () => {
    expect(
      await errors(CreateSiteBodyDto, {
        ...valid,
        tenantId: 'x',
        qrCode: 'y',
      }),
    ).toEqual(['tenantId', 'qrCode']);
    expect(await errors(UpdateSiteBodyDto, { qrCode: 'y' })).toEqual([
      'qrCode',
    ]);
  });

  it('allows partial updates and isActive', async () => {
    expect(await errors(UpdateSiteBodyDto, { isActive: false })).toEqual([]);
  });

  it('transforms and bounds the page query', async () => {
    const parsed = plainToInstance(PageQueryDto, {
      page: '2',
      pageSize: '50',
    });
    expect(parsed).toEqual({ page: 2, pageSize: 50 });
    expect(await errors(PageQueryDto, { pageSize: 101 })).toEqual([
      'pageSize',
    ]);
  });

  it('validates posts', async () => {
    expect(
      await errors(CreatePostBodyDto, {
        name: 'Gate',
        requiredSkills: ['first-aid'],
        minPeople: 2,
      }),
    ).toEqual([]);
    expect(
      await errors(CreatePostBodyDto, {
        name: 'Gate',
        requiredSkills: ['a', 'a'],
        minPeople: 0,
      }),
    ).toEqual(['requiredSkills', 'minPeople']);
  });
});
