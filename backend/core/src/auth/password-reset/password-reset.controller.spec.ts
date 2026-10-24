import { IS_PUBLIC_KEY } from '../../http/decorators/public.decorator';
import type { VerifiedActor } from '../verified-actor';
import type { PasswordResetConfirmService } from './password-reset-confirm.service';
import type { PasswordResetCreateService } from './password-reset-create.service';
import { PasswordResetController } from './password-reset.controller';

jest.mock('../../config', () => ({ envs: {} }));
// Only the class shape of the generated client is needed.
jest.mock('../prisma/generated/client', () => ({ PrismaClient: class {} }));

const ACTOR: VerifiedActor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-00000000000a',
  role: 'admin',
  tenantStatus: 'active',
  plan: null,
  features: null,
};
const USER_ID = '0199b7e0-0000-7000-8000-000000000002';

describe('PasswordResetController', () => {
  const createService = {
    create: jest.fn().mockResolvedValue({ token: 't', expiresAt: 'x' }),
  };
  const confirmService = {
    confirm: jest.fn().mockResolvedValue({ ok: true }),
  };
  const controller = new PasswordResetController(
    createService as unknown as PasswordResetCreateService,
    confirmService as unknown as PasswordResetConfirmService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('maps the path param and the verified actor on create', async () => {
    await controller.create(ACTOR, { userId: USER_ID });

    expect(createService.create).toHaveBeenCalledWith({
      userId: USER_ID,
      actor: {
        userId: ACTOR.userId,
        tenantId: ACTOR.tenantId,
        role: ACTOR.role,
      },
    });
  });

  it('forwards the confirm body without an actor', async () => {
    const body = { token: 't', password: 'password-2' };

    await controller.confirm(body);

    expect(confirmService.confirm).toHaveBeenCalledWith(body);
  });

  it.each([
    ['create', false],
    ['confirm', true],
  ] as const)('marks %s as public: %s', (method, isPublic) => {
    const flag = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      PasswordResetController.prototype[method],
    ) as boolean | undefined;

    expect(flag === true).toBe(isPublic);
  });
});
