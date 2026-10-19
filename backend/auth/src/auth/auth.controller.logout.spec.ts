import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../common/exceptions/app.exceptions';
import { createValidationPipe } from '../common/pipes/validation.pipe';
import { AuthController } from './auth.controller';
import { RefreshTokenDto } from './dto/refresh-token.dto';

jest.mock('../config', () => ({
  envs: {
    jwtSecret: 'x'.repeat(40),
    accessTokenTtl: '15m',
    refreshTokenTtl: '7d',
  },
}));
// The generated client is ESM-only; only its class shape is needed.
jest.mock('../generated/prisma/client', () => ({ PrismaClient: class {} }));

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: RefreshTokenDto,
};

// Covers: S3.6
describe('AuthController.logout', () => {
  it('forwards the payload to AuthService.logout', async () => {
    const logout = jest.fn().mockResolvedValue({ ok: true });
    const controller = new AuthController({ logout } as never);
    const dto = { refreshToken: 'abc' } as RefreshTokenDto;

    await expect(controller.logout(dto)).resolves.toEqual({ ok: true });
    expect(logout).toHaveBeenCalledWith(dto);
  });

  it.each([
    ['missing token', {}],
    ['empty token', { refreshToken: '' }],
    ['extra field', { refreshToken: 'abc', userId: 'u1' }],
  ])('validation rejects %s with 422', async (_label, payload) => {
    const error = await createValidationPipe()
      .transform(payload, metadata)
      .then(
        () => {
          throw new Error('Expected the pipe to reject the payload');
        },
        (e: unknown) => e,
      );

    expect(error).toBeInstanceOf(ValidationException);
    expect((error as ValidationException).getError()).toEqual(
      expect.objectContaining({ status: 422, code: 'validation_error' }),
    );
  });
});
