import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { RegenerateInvitationDto } from './invitation-regenerate.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: RegenerateInvitationDto,
};

const actor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'admin',
};
const invitationId = '0199b7e0-0000-7000-8000-0000000000bb';

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

// Covers: S4.3
describe('RegenerateInvitationDto with the global validation pipe', () => {
  it('accepts an actor and an invitation id', async () => {
    await expect(run({ actor, invitationId })).resolves.toBeInstanceOf(
      RegenerateInvitationDto,
    );
  });

  it.each([
    ['missing actor', { invitationId }],
    ['missing invitationId', { actor }],
    ['non-uuid invitationId', { actor, invitationId: 'abc' }],
    ['numeric invitationId', { actor, invitationId: 7 }],
    ['extra field', { actor, invitationId, tenantId: actor.tenantId }],
    [
      'extra actor field',
      { actor: { ...actor, isActive: true }, invitationId },
    ],
    [
      'unknown actor role',
      { actor: { ...actor, role: 'ADMIN' }, invitationId },
    ],
    [
      'non-uuid actor userId',
      { actor: { ...actor, userId: 'x' }, invitationId },
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
