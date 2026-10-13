import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { ConfirmPasswordResetDto } from './password-reset-confirm.dto';
import { CreatePasswordResetDto } from './password-reset-create.dto';

const actor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'admin',
};
const userId = '0199b7e0-0000-7000-8000-0000000000bb';

function run(metatype: ArgumentMetadata['metatype'], value: unknown) {
  return createValidationPipe().transform(value, { type: 'body', metatype });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('Expected the pipe to reject the payload');
    },
    (e: unknown) => e,
  );
}

function expectValidationError(error: unknown) {
  expect(error).toBeInstanceOf(ValidationException);
  expect((error as ValidationException).getError()).toEqual(
    expect.objectContaining({ status: 422, code: 'validation_error' }),
  );
}

// Covers: S5.6
describe('CreatePasswordResetDto with the global validation pipe', () => {
  it('accepts an actor and a user id', async () => {
    await expect(
      run(CreatePasswordResetDto, { actor, userId }),
    ).resolves.toBeInstanceOf(CreatePasswordResetDto);
  });

  it.each([
    ['missing actor', { userId }],
    ['missing userId', { actor }],
    ['non-uuid userId', { actor, userId: 'abc' }],
    ['extra field', { actor, userId, tenantId: actor.tenantId }],
    ['unknown actor role', { actor: { ...actor, role: 'ADMIN' }, userId }],
    ['non-uuid actor id', { actor: { ...actor, userId: 'x' }, userId }],
  ])('rejects %s with 422', async (_label, payload) => {
    expectValidationError(
      await rejection(run(CreatePasswordResetDto, payload)),
    );
  });
});

// Covers: S5.6
describe('ConfirmPasswordResetDto with the global validation pipe', () => {
  const token = 'a'.repeat(43);
  const password = 'correct horse battery';

  it('accepts a token and a password', async () => {
    await expect(
      run(ConfirmPasswordResetDto, { token, password }),
    ).resolves.toBeInstanceOf(ConfirmPasswordResetDto);
  });

  it.each([
    ['missing token', { password }],
    ['empty token', { token: '', password }],
    ['oversized token', { token: 'a'.repeat(257), password }],
    ['non-string token', { token: 1, password }],
    ['missing password', { token }],
    ['short password', { token, password: '1234567' }],
    ['oversized password', { token, password: 'a'.repeat(129) }],
    ['non-string password', { token, password: 12345678 }],
    ['extra userId', { token, password, userId }],
  ])('rejects %s with 422', async (_label, payload) => {
    expectValidationError(
      await rejection(run(ConfirmPasswordResetDto, payload)),
    );
  });
});
