import { RequestMethod } from '@nestjs/common';
import { envs } from '../config';
import { IS_PUBLIC_KEY } from '../http/decorators/public.decorator';
import { REQUIRES_FEATURE_KEY } from '../http/decorators/requires-feature.decorator';
import { AuthController } from './auth.controller';
import type { AuthService } from './auth.service';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
    cookieSecure: true,
  },
}));
// Only the class shape of the generated client is needed.
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

const PAIR = { accessToken: 'a', refreshToken: 'r', expiresIn: 900 };
const SOCKET = { token: 'socket.jwt.value', expiresIn: 60 };

describe('AuthController', () => {
  const service = {
    register: jest.fn().mockResolvedValue(PAIR),
    login: jest.fn().mockResolvedValue(PAIR),
    refresh: jest.fn().mockResolvedValue(PAIR),
    logout: jest.fn().mockResolvedValue({ ok: true }),
    issueSocketToken: jest.fn().mockResolvedValue(SOCKET),
  };
  const controller = new AuthController(service as unknown as AuthService);

  beforeEach(() => jest.clearAllMocks());

  describe('socketToken', () => {
    const actor = {
      userId: 'u1',
      tenantId: 't1',
      role: 'owner' as const,
      tenantStatus: 'active' as const,
      plan: 'pro' as const,
      features: { tower: true },
    };

    it('hands the verified actor to the facade and returns the token body', async () => {
      await expect(controller.socketToken(actor)).resolves.toBe(SOCKET);

      expect(service.issueSocketToken).toHaveBeenCalledWith(actor);
    });

    it('is guarded (not public) and requires the tower feature', () => {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          AuthController.prototype.socketToken,
        ),
      ).toBeUndefined();
      expect(
        Reflect.getMetadata(
          REQUIRES_FEATURE_KEY,
          AuthController.prototype.socketToken,
        ),
      ).toBe('tower');
    });

    it('is a POST on auth/socket-token', () => {
      const method = Reflect.getMetadata(
        'method',
        AuthController.prototype.socketToken,
      ) as number;
      const path = Reflect.getMetadata(
        'path',
        AuthController.prototype.socketToken,
      ) as string;

      expect(method).toBe(RequestMethod.POST);
      expect(path).toBe('socket-token');
    });
  });

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

  describe('cookie Secure flag', () => {
    const mutableEnvs = envs as { cookieSecure: boolean };
    const original = mutableEnvs.cookieSecure;
    const fakeRes = () => {
      const setHeader = jest.fn();
      return { setHeader, res: { setHeader } as never };
    };
    const cookiesOf = (setHeader: jest.Mock): string[] =>
      (setHeader.mock.calls[0] as [string, string[]])[1];

    afterEach(() => {
      mutableEnvs.cookieSecure = original;
    });

    it.each([
      ['login', true],
      ['login', false],
      ['logout', true],
      ['logout', false],
    ] as const)('%s with COOKIE_SECURE=%s', async (method, secure) => {
      mutableEnvs.cookieSecure = secure;
      const { setHeader, res } = fakeRes();

      await controller[method](
        { email: 'a@acme.test', password: 'p', refreshToken: 'r' },
        res,
      );

      const cookies = cookiesOf(setHeader);
      expect(cookies).toHaveLength(3);
      for (const cookie of cookies) {
        expect(cookie.endsWith('; Secure')).toBe(secure);
      }
    });

    it('ignores NODE_ENV', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      mutableEnvs.cookieSecure = false;
      const { setHeader, res } = fakeRes();

      await controller.login({ email: 'a@acme.test', password: 'p' }, res);

      process.env.NODE_ENV = previous;
      expect(cookiesOf(setHeader).join(';')).not.toContain('Secure');
    });
  });
});
