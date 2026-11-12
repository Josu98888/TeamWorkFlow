import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { LoginDto } from './login.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: LoginDto };
const valid = { email: 'ana@acme.test', password: 'whatever' };

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

async function expectValidationError(value: unknown) {
  const error = await run(value).then(
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

// Covers: S3.4
describe('LoginDto with the global validation pipe', () => {
  it('accepts a valid payload and normalizes the email', async () => {
    const dto = (await run({
      ...valid,
      email: '  Ana@ACME.test ',
    })) as LoginDto;

    expect(dto).toBeInstanceOf(LoginDto);
    expect(dto.email).toBe('ana@acme.test');
  });

  it('does not impose a minimum password length', async () => {
    await expect(run({ ...valid, password: 'x' })).resolves.toBeInstanceOf(
      LoginDto,
    );
  });

  it.each(['role', 'tenantId'])('rejects an extra %s field', async (field) => {
    await expectValidationError({ ...valid, [field]: 'owner' });
  });

  it.each(['email', 'password'])('rejects a missing %s', async (field) => {
    const payload: Record<string, unknown> = { ...valid };
    delete payload[field];

    await expectValidationError(payload);
  });

  it.each([
    ['invalid email', { email: 'nope' }],
    ['empty password', { password: '' }],
    ['overlong password', { password: 'x'.repeat(129) }],
    ['non-string password', { password: 1234 }],
  ])('rejects %s', async (_label, patch) => {
    await expectValidationError({ ...valid, ...patch });
  });
});
