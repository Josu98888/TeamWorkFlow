import { IS_PUBLIC_KEY } from '../../http/decorators/public.decorator';
import type { VerifiedActor } from '../verified-actor';
import type { UserAssignSitesService } from './user-assign-sites.service';
import type { UserChangeRoleService } from './user-change-role.service';
import type { UserDeactivateService } from './user-deactivate.service';
import { UsersController } from './users.controller';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const ACTOR: VerifiedActor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-00000000000a',
  role: 'owner',
  tenantStatus: 'active',
  plan: null,
  features: null,
};
const SERVICE_ACTOR = {
  userId: ACTOR.userId,
  tenantId: ACTOR.tenantId,
  role: ACTOR.role,
};
const USER_ID = '0199b7e0-0000-7000-8000-000000000002';
const SITE_ID = '0199b7e0-0000-7000-8000-0000000000a1';

describe('UsersController', () => {
  const changeRole = { changeRole: jest.fn().mockResolvedValue({ ok: true }) };
  const assignSites = {
    assignSites: jest.fn().mockResolvedValue({ ok: true }),
  };
  const deactivate = { deactivate: jest.fn().mockResolvedValue({ ok: true }) };
  const controller = new UsersController(
    changeRole as unknown as UserChangeRoleService,
    assignSites as unknown as UserAssignSitesService,
    deactivate as unknown as UserDeactivateService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('builds { ...body, ...params, actor } for each operation', async () => {
    await controller.changeRole(
      ACTOR,
      { userId: USER_ID },
      { role: 'supervisor' },
    );
    await controller.assignSites(
      ACTOR,
      { userId: USER_ID },
      { siteIds: [SITE_ID] },
    );
    await controller.deactivate(ACTOR, { userId: USER_ID });

    expect(changeRole.changeRole).toHaveBeenCalledWith({
      role: 'supervisor',
      userId: USER_ID,
      actor: SERVICE_ACTOR,
    });
    expect(assignSites.assignSites).toHaveBeenCalledWith({
      siteIds: [SITE_ID],
      userId: USER_ID,
      actor: SERVICE_ACTOR,
    });
    expect(deactivate.deactivate).toHaveBeenCalledWith({
      userId: USER_ID,
      actor: SERVICE_ACTOR,
    });
  });

  it('keeps a hostile body from overriding the verified actor', async () => {
    const hostile = { role: 'employee', actor: { role: 'owner' } };

    await controller.changeRole(
      ACTOR,
      { userId: USER_ID },
      hostile as unknown as { role: 'employee' },
    );

    expect(changeRole.changeRole).toHaveBeenCalledWith(
      expect.objectContaining({ actor: SERVICE_ACTOR }),
    );
  });

  it.each(['changeRole', 'assignSites', 'deactivate'] as const)(
    'keeps %s guarded',
    (method) => {
      expect(
        Reflect.getMetadata(IS_PUBLIC_KEY, UsersController.prototype[method]),
      ).toBeUndefined();
    },
  );

  it('does not expose list-recipients over HTTP', () => {
    expect('listRecipients' in UsersController.prototype).toBe(false);
  });
});
