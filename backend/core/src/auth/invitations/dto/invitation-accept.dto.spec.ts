import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../../common/pipes/validation.pipe';
import { AcceptInvitationDto } from './invitation-accept.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: AcceptInvitationDto,
};

const valid = {
  token: 'abc123_-token',
  name: 'Ana Perez',
  password: 'correct horse battery',
};

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

// Covers: S4.4
describe('AcceptInvitationDto with the global validation pipe', () => {
  it('accepts token, name and password', async () => {
    await expect(run(valid)).resolves.toBeInstanceOf(AcceptInvitationDto);
  });

  it('trims the name', async () => {
    const dto = (await run({ ...valid, name: '  Ana Perez ' })) as {
      name: string;
    };

    expect(dto.name).toBe('Ana Perez');
  });

  it('accepts the registration password bounds (8 and 128 characters)', async () => {
    await expect(
      run({ ...valid, password: 'a'.repeat(8) }),
    ).resolves.toBeDefined();
    await expect(
      run({ ...valid, password: 'a'.repeat(128) }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['missing token', { name: valid.name, password: valid.password }],
    ['empty token', { ...valid, token: '' }],
    ['oversized token', { ...valid, token: 'a'.repeat(257) }],
    ['non-string token', { ...valid, token: 12345 }],
    ['missing name', { token: valid.token, password: valid.password }],
    ['blank name', { ...valid, name: '   ' }],
    ['oversized name', { ...valid, name: 'a'.repeat(101) }],
    ['missing password', { token: valid.token, name: valid.name }],
    ['short password', { ...valid, password: 'a'.repeat(7) }],
    ['oversized password', { ...valid, password: 'a'.repeat(129) }],
    ['role field', { ...valid, role: 'owner' }],
    ['tenantId field', { ...valid, tenantId: 'x' }],
    ['email field', { ...valid, email: 'a@b.test' }],
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
