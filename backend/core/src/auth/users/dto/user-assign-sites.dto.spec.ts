import { ArgumentMetadata } from '@nestjs/common';
import { ValidationException } from '../../../common/exceptions/app.exceptions';
import { createValidationPipe } from '../../../common/pipes/validation.pipe';
import { AssignUserSitesDto, MAX_SITE_IDS } from './user-assign-sites.dto';

const metadata: ArgumentMetadata = {
  type: 'body',
  metatype: AssignUserSitesDto,
};

const actor = {
  userId: '0199b7e0-0000-7000-8000-000000000001',
  tenantId: '0199b7e0-0000-7000-8000-000000000002',
  role: 'admin',
};
const userId = '0199b7e0-0000-7000-8000-0000000000bb';
const site1 = '0199b7e0-0000-7000-8000-0000000000a1';
const site2 = '0199b7e0-0000-7000-8000-0000000000a2';

function run(value: unknown): Promise<unknown> {
  return createValidationPipe().transform(value, metadata);
}

function manySites(count: number): string[] {
  return Array.from(
    { length: count },
    (_, i) => `0199b7e0-0000-7000-8000-${i.toString(16).padStart(12, '0')}`,
  );
}

// Covers: S5.3
describe('AssignUserSitesDto with the global validation pipe', () => {
  it.each([
    ['one site', [site1]],
    ['several sites', [site1, site2]],
    ['an empty set (unassign all)', []],
    ['duplicates (removed by the service)', [site1, site1]],
    ['the maximum number of sites', manySites(MAX_SITE_IDS)],
  ])('accepts %s', async (_label, siteIds) => {
    await expect(run({ actor, userId, siteIds })).resolves.toBeInstanceOf(
      AssignUserSitesDto,
    );
  });

  it.each([
    ['missing actor', { userId, siteIds: [site1] }],
    ['missing userId', { actor, siteIds: [site1] }],
    ['missing siteIds', { actor, userId }],
    ['non-uuid userId', { actor, userId: 'abc', siteIds: [site1] }],
    ['siteIds not an array', { actor, userId, siteIds: site1 }],
    ['null siteIds', { actor, userId, siteIds: null }],
    ['non-uuid site id', { actor, userId, siteIds: [site1, 'north'] }],
    ['numeric site id', { actor, userId, siteIds: [7] }],
    ['nested array', { actor, userId, siteIds: [[site1]] }],
    [
      'more than the maximum number of sites',
      { actor, userId, siteIds: manySites(MAX_SITE_IDS + 1) },
    ],
    [
      'extra field',
      { actor, userId, siteIds: [site1], tenantId: actor.tenantId },
    ],
    [
      'extra actor field',
      { actor: { ...actor, isActive: true }, userId, siteIds: [site1] },
    ],
    [
      'unknown actor role',
      { actor: { ...actor, role: 'ADMIN' }, userId, siteIds: [site1] },
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
