import { ArgumentsHost } from '@nestjs/common';

import { firstValueFrom } from 'rxjs';
import {
  InvalidTokenException,
  ValidationException,
} from '../common/exceptions/app.exceptions';
import { NatsErrorFilter } from '../common/filters/nats-exception.filter';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { AuthTokenResponder } from './auth-token.responder';
import { AUTH_PATTERNS } from './auth.patterns';
import type { AuthService } from './auth.service';
import { VerifyTokenDto } from './dto/verify-token.dto';
import type { VerifiedActor } from './verified-actor';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// Only the class shape of the generated client is needed.
jest.mock('./prisma/generated/client', () => ({ PrismaClient: class {} }));

const ACTOR: VerifiedActor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'owner',
  tenantStatus: 'active',
  plan: 'pro',
  features: { tasks: true },
};

describe('AuthTokenResponder', () => {
  const verify = jest.fn();
  const responder = new AuthTokenResponder({
    verify,
  } as unknown as AuthService);

  beforeEach(() => jest.clearAllMocks());

  it('answers the auth.token.verify pattern', () => {
    const pattern = Reflect.getMetadata(
      'microservices:pattern',
      Object.getOwnPropertyDescriptor(AuthTokenResponder.prototype, 'verify')
        ?.value as object,
    ) as unknown[];

    expect(pattern).toEqual([AUTH_PATTERNS.tokenVerify]);
    expect(AUTH_PATTERNS.tokenVerify).toBe('auth.token.verify');
  });

  it('returns the facade result unchanged', async () => {
    verify.mockResolvedValue(ACTOR);

    await expect(responder.verify({ accessToken: 't' })).resolves.toBe(ACTOR);
    expect(verify).toHaveBeenCalledWith({ accessToken: 't' });
  });

  it('maps an AppException to { status, code, message } for the caller', async () => {
    verify.mockRejectedValue(new InvalidTokenException());
    const error = await responder.verify({ accessToken: 't' }).catch((e) => e);

    const result = new NatsErrorFilter().catch(error, {} as ArgumentsHost);

    await expect(firstValueFrom(result)).rejects.toEqual(
      expect.objectContaining({ status: 401, code: 'invalid_token' }),
    );
  });

  it('rejects an invalid payload with a validation error before calling the facade', async () => {
    const pipe = createValidationPipe();
    const metadata = { type: 'body', metatype: VerifyTokenDto } as const;

    await expect(pipe.transform({}, metadata)).rejects.toBeInstanceOf(
      ValidationException,
    );
    await expect(
      pipe.transform({ accessToken: 't', tenantId: 'x' }, metadata),
    ).rejects.toBeInstanceOf(ValidationException);
    expect(verify).not.toHaveBeenCalled();
  });
});
