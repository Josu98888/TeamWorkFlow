import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { CreateInvitationDto } from './invitation-create.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: CreateInvitationDto,
};

const actor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'owner',
};
const valid = { actor, email: 'new@acme.test', role: 'employee' };

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

// Covers: S4.1
describe('CreateInvitationDto with the global validation pipe', () => {
  it('accepts a valid payload and normalizes the email', async () => {
    const dto = (await run({
      ...valid,
      email: '  New@ACME.test ',
    })) as CreateInvitationDto;

    expect(dto).toBeInstanceOf(CreateInvitationDto);
    expect(dto.email).toBe('new@acme.test');
    expect(dto.actor.role).toBe('owner');
  });

  it('accepts an actor with a null tenant (refused later by the policy)', async () => {
    await expect(
      run({
        ...valid,
        actor: { ...actor, tenantId: null, role: 'platform_admin' },
      }),
    ).resolves.toBeInstanceOf(CreateInvitationDto);
  });

  it.each(['admin', 'supervisor', 'employee'])(
    'accepts the invited role %s',
    async (role) => {
      await expect(run({ ...valid, role })).resolves.toBeInstanceOf(
        CreateInvitationDto,
      );
    },
  );

  it.each(['owner', 'platform_admin', 'OWNER', 'ADMIN', 'root', ''])(
    'rejects the invited role %p',
    async (role) => {
      await expectValidationError({ ...valid, role });
    },
  );

  it.each([
    ['missing actor', { email: valid.email, role: valid.role }],
    ['bad email', { ...valid, email: 'nope' }],
    ['missing email', { actor, role: 'employee' }],
    ['missing role', { actor, email: valid.email }],
    ['extra field', { ...valid, tenantId: actor.tenantId }],
    ['extra actor field', { ...valid, actor: { ...actor, isActive: true } }],
    ['non-uuid actor userId', { ...valid, actor: { ...actor, userId: 'x' } }],
    [
      'non-uuid actor tenantId',
      { ...valid, actor: { ...actor, tenantId: 'x' } },
    ],
    [
      'missing actor tenantId',
      { ...valid, actor: { userId: actor.userId, role: 'owner' } },
    ],
    ['unknown actor role', { ...valid, actor: { ...actor, role: 'OWNER' } }],
  ])('rejects %s', async (_label, payload) => {
    await expectValidationError(payload);
  });
});
