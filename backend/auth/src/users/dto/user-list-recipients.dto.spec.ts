import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { ListRecipientsDto } from './user-list-recipients.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: ListRecipientsDto,
};

const tenantId = '0199b7e0-0000-7000-8000-000000000002';
const siteId = '0199b7e0-0000-7000-8000-0000000000cc';

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

// Covers: S5.5
describe('ListRecipientsDto with the global validation pipe', () => {
  it.each([
    ['one role', { tenantId, roles: ['owner'] }],
    [
      'every tenant role',
      { tenantId, roles: ['owner', 'admin', 'supervisor', 'employee'] },
    ],
    ['a site id', { tenantId, roles: ['supervisor'], siteId }],
  ])('accepts %s', async (_label, payload) => {
    await expect(run(payload)).resolves.toBeInstanceOf(ListRecipientsDto);
  });

  it.each([
    ['missing tenantId', { roles: ['owner'] }],
    ['non-uuid tenantId', { tenantId: 'abc', roles: ['owner'] }],
    ['missing roles', { tenantId }],
    ['empty roles', { tenantId, roles: [] }],
    ['roles not an array', { tenantId, roles: 'owner' }],
    ['unknown role', { tenantId, roles: ['boss'] }],
    ['platform_admin', { tenantId, roles: ['platform_admin'] }],
    ['prisma enum value', { tenantId, roles: ['OWNER'] }],
    ['duplicated roles', { tenantId, roles: ['owner', 'owner'] }],
    [
      'too many roles',
      {
        tenantId,
        roles: ['owner', 'admin', 'supervisor', 'employee', 'owner'],
      },
    ],
    ['non-uuid siteId', { tenantId, roles: ['supervisor'], siteId: 'x' }],
    ['extra field', { tenantId, roles: ['owner'], isActive: false }],
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
