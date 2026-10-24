import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { RegisterDto } from './register.dto';

const metadata: ArgumentMetadata = { type: 'body', metatype: RegisterDto };

const valid = {
  tenantName: 'Acme Security',
  name: 'Ana Perez',
  email: 'ana@acme.test',
  password: 'correct horse battery',
};

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

async function errorOf(value: unknown) {
  try {
    await run(value);
  } catch (error) {
    return error as ValidationException;
  }
  throw new Error('Expected the pipe to reject the payload');
}

function expectValidationError(error: ValidationException) {
  expect(error).toBeInstanceOf(ValidationException);
  expect(error.getError()).toEqual(
    expect.objectContaining({ status: 422, code: 'validation_error' }),
  );
}

// Covers: S3.3
describe('RegisterDto with the global validation pipe', () => {
  it('accepts a valid payload as a RegisterDto', async () => {
    await expect(run(valid)).resolves.toBeInstanceOf(RegisterDto);
  });

  it('trims and lowercases the email', async () => {
    const dto = (await run({
      ...valid,
      email: '  Ana@ACME.test ',
    })) as RegisterDto;

    expect(dto.email).toBe('ana@acme.test');
  });

  it('trims tenantName and name', async () => {
    const dto = (await run({
      ...valid,
      tenantName: '  Acme  ',
      name: ' Ana ',
    })) as RegisterDto;

    expect(dto.tenantName).toBe('Acme');
    expect(dto.name).toBe('Ana');
  });

  it.each(['role', 'tenantId', 'status'])(
    'rejects an extra %s field with 422 validation_error',
    async (field) => {
      expectValidationError(
        await errorOf({ ...valid, [field]: 'platform_admin' }),
      );
    },
  );

  it.each(['tenantName', 'name', 'email', 'password'])(
    'rejects a missing %s with 422 validation_error',
    async (field) => {
      const payload: Record<string, unknown> = { ...valid };
      delete payload[field];

      expectValidationError(await errorOf(payload));
    },
  );

  it.each([
    ['blank tenantName', { tenantName: '   ' }],
    ['blank name', { name: '' }],
    ['invalid email', { email: 'not-an-email' }],
    ['short password', { password: 'short' }],
    ['overlong password', { password: 'x'.repeat(129) }],
    ['non-string password', { password: 12345678 }],
  ])('rejects %s', async (_label, patch) => {
    expectValidationError(await errorOf({ ...valid, ...patch }));
  });
});
