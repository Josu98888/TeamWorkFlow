import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { ChangeUserRoleDto } from './user-change-role.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: ChangeUserRoleDto,
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

// Covers: S5.2
describe('ChangeUserRoleDto with the global validation pipe', () => {
  it.each(['admin', 'supervisor', 'employee'])(
    'accepts the target role %s',
    async (role) => {
      await expect(run({ actor, userId, role })).resolves.toBeInstanceOf(
        ChangeUserRoleDto,
      );
    },
  );

  it.each([
    ['missing actor', { userId, role: 'employee' }],
    ['missing userId', { actor, role: 'employee' }],
    ['missing role', { actor, userId }],
    ['non-uuid userId', { actor, userId: 'abc', role: 'employee' }],
    ['owner as target role', { actor, userId, role: 'owner' }],
    [
      'platform_admin as target role',
      { actor, userId, role: 'platform_admin' },
    ],
    ['Prisma enum value', { actor, userId, role: 'EMPLOYEE' }],
    ['unknown role', { actor, userId, role: 'manager' }],
    ['numeric role', { actor, userId, role: 1 }],
    [
      'extra field',
      { actor, userId, role: 'employee', tenantId: actor.tenantId },
    ],
    [
      'extra actor field',
      { actor: { ...actor, isActive: true }, userId, role: 'employee' },
    ],
    [
      'unknown actor role',
      { actor: { ...actor, role: 'ADMIN' }, userId, role: 'employee' },
    ],
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
