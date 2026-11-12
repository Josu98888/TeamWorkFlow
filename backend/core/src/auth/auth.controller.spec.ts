import { IS_PUBLIC_KEY } from '../http/decorators/public.decorator';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed.
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

const PAIR = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };

describe('AuthController', () => {
  const service = {
    register: jest.fn().mockResolvedValue(PAIR),
    login: jest.fn().mockResolvedValue(PAIR),
    refresh: jest.fn().mockResolvedValue(PAIR),
    logout: jest.fn().mockResolvedValue({ ok: true }),
  };
  const controller = new AuthController(service as unknown as AuthService);

  beforeEach(() => jest.clearAllMocks());

  it('forwards each body to its facade operation', async () => {
    const register = {
      tenantName: 'Acme',
      name: 'Ana',
      email: 'a@acme.test',
      password: 'password-1',
    };
    const login = { email: 'a@acme.test', password: 'password-1' };
    const token = { refreshToken: 'abc' };

    await expect(controller.register(register)).resolves.toBe(PAIR);
    await expect(controller.login(login)).resolves.toBe(PAIR);
    await expect(controller.refresh(token)).resolves.toBe(PAIR);
    await expect(controller.logout(token)).resolves.toEqual({ ok: true });

    expect(service.register).toHaveBeenCalledWith(register);
    expect(service.login).toHaveBeenCalledWith(login);
    expect(service.refresh).toHaveBeenCalledWith(token);
    expect(service.logout).toHaveBeenCalledWith(token);
  });

  it.each([
    ['register', true],
    ['login', true],
    ['refresh', true],
    ['logout', false],
  ] as const)('marks %s as public: %s', (method, isPublic) => {
    const flag = Reflect.getMetadata(
      IS_PUBLIC_KEY,
      AuthController.prototype[method],
    ) as boolean | undefined;

    expect(flag === true).toBe(isPublic);
  });
});
