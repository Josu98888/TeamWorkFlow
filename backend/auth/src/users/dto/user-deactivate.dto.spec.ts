import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { DeactivateUserDto } from './user-deactivate.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: DeactivateUserDto,
};

const actor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'admin',
};
const userId = '0199b7e0-0000-7000-8000-0000000000bb';

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

// Covers: S5.4
describe('DeactivateUserDto with the global validation pipe', () => {
  it('accepts an actor and a user id', async () => {
    await expect(run({ actor, userId })).resolves.toBeInstanceOf(
      DeactivateUserDto,
    );
  });

  it.each([
    ['missing actor', { userId }],
    ['missing userId', { actor }],
    ['non-uuid userId', { actor, userId: 'abc' }],
    ['numeric userId', { actor, userId: 1 }],
    ['extra field', { actor, userId, tenantId: actor.tenantId }],
    ['extra actor field', { actor: { ...actor, isActive: true }, userId }],
    ['unknown actor role', { actor: { ...actor, role: 'ADMIN' }, userId }],
    ['non-uuid actor id', { actor: { ...actor, userId: 'x' }, userId }],
  ])('rejects %s with 422', async (_label, payload) => {
    const error = await run(payload).then(
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
