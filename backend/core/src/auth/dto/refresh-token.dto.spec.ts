import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { RefreshTokenDto } from './refresh-token.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: RefreshTokenDto,
};

async function expectValidationError(value: unknown) {
  const error = await createValidationPipe()
    .transform(value, metadata)
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
}

// Covers: S3.5
describe('RefreshTokenDto with the global validation pipe', () => {
  it('accepts a token string', async () => {
    await expect(
      createValidationPipe().transform({ refreshToken: 'abc' }, metadata),
    ).resolves.toBeInstanceOf(RefreshTokenDto);
  });

  it.each([
    ['missing token', {}],
    ['empty token', { refreshToken: '' }],
    ['non-string token', { refreshToken: 123 }],
    ['overlong token', { refreshToken: 'x'.repeat(513) }],
    ['extra field', { refreshToken: 'abc', userId: 'u1' }],
  ])('rejects %s', async (_label, payload) => {
    await expectValidationError(payload);
  });
});
