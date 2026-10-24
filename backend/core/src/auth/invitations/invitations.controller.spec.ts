import { IS_PUBLIC_KEY } from '../../http/decorators/public.decorator';
import type { VerifiedActor } from '../verified-actor';
import type { InvitationAcceptService } from './invitation-accept.service';
import { InvitationsController } from './invitations.controller';
import type { InvitationsService } from './invitations.service';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const ACTOR: VerifiedActor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-00000000000a',
  role: 'admin',
  tenantStatus: 'active',
  plan: 'pro',
  features: { tasks: true },
};
const SERVICE_ACTOR = {
  userId: ACTOR.userId,
  tenantId: ACTOR.tenantId,
  role: ACTOR.role,
};
const INVITATION_ID = '0199b7e0-0000-7000-8000-0000000000c1';

describe('InvitationsController', () => {
  const invitations = {
    create: jest.fn().mockResolvedValue({ invitationId: 'i' }),
    list: jest.fn().mockResolvedValue([]),
    regenerate: jest.fn().mockResolvedValue({ invitationId: 'j' }),
  };
  const accepts = { accept: jest.fn().mockResolvedValue({ accessToken: 'a' }) };
  const controller = new InvitationsController(
    invitations as unknown as InvitationsService,
    accepts as unknown as InvitationAcceptService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('adds only the documented actor fields to create and list', async () => {
    await controller.create(ACTOR, { email: 'a@acme.test', role: 'employee' });
    await controller.list(ACTOR);

    expect(invitations.create).toHaveBeenCalledWith({
      email: 'a@acme.test',
      role: 'employee',
      actor: SERVICE_ACTOR,
    });
    expect(invitations.list).toHaveBeenCalledWith({ actor: SERVICE_ACTOR });
  });

  it('maps the path param and the actor on regenerate', async () => {
    await controller.regenerate(ACTOR, { invitationId: INVITATION_ID });

    expect(invitations.regenerate).toHaveBeenCalledWith({
      invitationId: INVITATION_ID,
      actor: SERVICE_ACTOR,
    });
  });

  it('forwards the accept body without an actor', async () => {
    const body = { token: 't', name: 'Ana', password: 'password-1' };

    await controller.accept(body);

    expect(accepts.accept).toHaveBeenCalledWith(body);
  });

  it.each([
    ['create', false],
    ['list', false],
    ['regenerate', false],
    ['accept', true],
  ] as const)('marks %s as public: %s', (method, isPublic) => {
    const flag = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      InvitationsController.prototype[method],
    ) as boolean | undefined;

    expect(flag === true).toBe(isPublic);
  });
});
