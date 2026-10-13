import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { ListInvitationsDto } from './invitation-list.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: ListInvitationsDto,
};

const actor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'admin',
};

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

// Covers: S4.2
describe('ListInvitationsDto with the global validation pipe', () => {
  it('accepts an actor', async () => {
    await expect(run({ actor })).resolves.toBeInstanceOf(ListInvitationsDto);
  });

  it.each([
    ['missing actor', {}],
    ['extra field', { actor, tenantId: actor.tenantId }],
    ['extra actor field', { actor: { ...actor, isActive: true } }],
    ['non-uuid actor userId', { actor: { ...actor, userId: 'x' } }],
    ['unknown actor role', { actor: { ...actor, role: 'ADMIN' } }],
    [
      'missing actor tenantId',
      { actor: { userId: actor.userId, role: 'admin' } },
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
