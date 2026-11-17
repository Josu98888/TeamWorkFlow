import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { VerifyTokenDto } from './verify-token.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: VerifyTokenDto,
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

// Covers: S3.7
describe('VerifyTokenDto with the global validation pipe', () => {
  it('accepts a token string', async () => {
    await expect(
      createValidationPipe().transform({ accessToken: 'a.b.c' }, metadata),
    ).resolves.toBeInstanceOf(VerifyTokenDto);
  });

  it.each(['access', 'socket'])('accepts the %s purpose', async (purpose) => {
    await expect(
      createValidationPipe().transform(
        { accessToken: 'a.b.c', purpose },
        metadata,
      ),
    ).resolves.toMatchObject({ purpose });
  });

  it('leaves the purpose undefined when it is omitted', async () => {
    const dto = await createValidationPipe().transform(
      { accessToken: 'a.b.c' },
      metadata,
    );

    expect((dto as VerifyTokenDto).purpose).toBeUndefined();
  });

  it.each([
    ['missing token', {}],
    ['empty token', { accessToken: '' }],
    ['non-string token', { accessToken: 42 }],
    ['overlong token', { accessToken: 'x'.repeat(4097) }],
    ['extra field', { accessToken: 'a.b.c', role: 'owner' }],
    ['unknown purpose', { accessToken: 'a.b.c', purpose: 'admin' }],
    ['non-string purpose', { accessToken: 'a.b.c', purpose: 1 }],
    ['empty purpose', { accessToken: 'a.b.c', purpose: '' }],
  ])('rejects %s', async (_label, payload) => {
    await expectValidationError(payload);
  });
});
