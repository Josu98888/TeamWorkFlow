import {
  ForbiddenException,
  PostNotFoundException,
  SiteNotFoundException,
} from '../../common/exceptions/app.exceptions';
import type { OrganizationActor } from '../organization-actor';
import { PostsService } from './posts.service';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const USER = '0199b7e0-0000-7000-8000-000000000001';
const SITE_1 = '0199b7e0-0000-7000-8000-0000000000a1';
const SITE_2 = '0199b7e0-0000-7000-8000-0000000000a2';
const POST_1 = '0199b7e0-0000-7000-8000-0000000000c1';
const POST_B = '0199b7e0-0000-7000-8000-0000000000c2';

interface PostRow {
  id: string;
  tenantId: string;
  siteId: string;
  name: string;
  requiredSkills: string[];
  minPeople: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Where {
  id?: string;
  tenantId: string;
  siteId?: string;
}

function matches(row: PostRow, where: Where) {
  return (
    row.tenantId === where.tenantId &&
    (where.id === undefined || row.id === where.id) &&
    (where.siteId === undefined || row.siteId === where.siteId)
  );
}

function post(id: string, tenantId: string, siteId: string): PostRow {
  return {
    id,
    tenantId,
    siteId,
    name: 'Gate',
    requiredSkills: [],
    minPeople: 1,
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

describe('PostsService', () => {
  let rows: PostRow[];
  const create = jest.fn();
  const findFirst = jest.fn();
  const findMany = jest.fn();
  const count = jest.fn();
  const updateMany = jest.fn();
  const requireAccessibleSite = jest.fn();
  const prisma = { post: { create, findFirst, findMany, count, updateMany } };
  let service: PostsService;

  beforeEach(() => {
    jest.resetAllMocks();
    rows = [post(POST_1, TENANT_A, SITE_1), post(POST_B, TENANT_B, SITE_1)];
    create.mockImplementation(({ data }: { data: Partial<PostRow> }) =>
      Promise.resolve({ ...post('new-post', TENANT_A, SITE_1), ...data }),
    );
    findFirst.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.find((r) => matches(r, where)) ?? null),
    );
    findMany.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.filter((r) => matches(r, where))),
    );
    count.mockImplementation(({ where }: { where: Where }) =>
      Promise.resolve(rows.filter((r) => matches(r, where)).length),
    );
    updateMany.mockImplementation(
      ({ where, data }: { where: Where; data: Partial<PostRow> }) => {
        const hits = rows.filter((r) => matches(r, where));
        hits.forEach((r) => Object.assign(r, data));
        return Promise.resolve({ count: hits.length });
      },
    );
    requireAccessibleSite.mockResolvedValue({});
    service = new PostsService(prisma as never, {
      requireAccessibleSite,
    } as never);
  });

  describe('create', () => {
    it('creates the post in the actor tenant with defaults, after the site check', async () => {
      const result = await service.create(actor('admin'), SITE_1, {
        name: 'Reception',
      });

      expect(requireAccessibleSite).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: TENANT_A }),
        SITE_1,
      );
      expect(create.mock.calls[0][0].data).toEqual({
        tenantId: TENANT_A,
        siteId: SITE_1,
        name: 'Reception',
        requiredSkills: [],
        minPeople: 1,
      });
      expect(result.name).toBe('Reception');
    });

    it('does not create when the site is not found in the tenant', async () => {
      requireAccessibleSite.mockRejectedValue(new SiteNotFoundException());
      const error = await errorOf(
        service.create(actor('owner'), SITE_2, { name: 'x' }),
      );
      expect(error).toBeInstanceOf(SiteNotFoundException);
      expect(create).not.toHaveBeenCalled();
    });

    it.each(['supervisor', 'employee'] as const)(
      'refuses %s with forbidden',
      async (role) => {
        const error = await errorOf(
          service.create(actor(role, { siteIds: [SITE_1] }), SITE_1, {
            name: 'x',
          }),
        );
        expect(error).toBeInstanceOf(ForbiddenException);
        expect(create).not.toHaveBeenCalled();
      },
    );
  });

  describe('update', () => {
    it('updates the given fields only', async () => {
      const result = await service.update(actor('admin'), POST_1, {
        minPeople: 3,
        isActive: false,
      });
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: POST_1, tenantId: TENANT_A },
        data: { minPeople: 3, isActive: false },
      });
      expect(result.minPeople).toBe(3);
    });

    it('answers 404 post_not_found for a post of another tenant', async () => {
      const error = await errorOf(
        service.update(actor('admin'), POST_B, { name: 'x' }),
      );
      expect(error).toBeInstanceOf(PostNotFoundException);
      expect((error as PostNotFoundException).getError()).toEqual(
        expect.objectContaining({ status: 404, code: 'post_not_found' }),
      );
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('refuses a supervisor with forbidden', async () => {
      const error = await errorOf(
        service.update(actor('supervisor', { siteIds: [SITE_1] }), POST_1, {
          name: 'x',
        }),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('list', () => {
    it('lists the posts of the site within the tenant', async () => {
      const result = await service.list(actor('owner'), SITE_1, {});
      expect(result.items.map((p) => p.id)).toEqual([POST_1]);
      expect(result.total).toBe(1);
      expect(findMany.mock.calls[0][0].where).toEqual({
        tenantId: TENANT_A,
        siteId: SITE_1,
      });
    });

    it('answers site_not_found when the site is out of the actor scope', async () => {
      requireAccessibleSite.mockRejectedValue(new SiteNotFoundException());
      const error = await errorOf(
        service.list(actor('supervisor', { siteIds: [SITE_2] }), SITE_1, {}),
      );
      expect(error).toBeInstanceOf(SiteNotFoundException);
      expect(findMany).not.toHaveBeenCalled();
    });

    it('refuses a platform admin', async () => {
      const error = await errorOf(
        service.list(actor('platform_admin', { tenantId: null }), SITE_1, {}),
      );
      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });
});
