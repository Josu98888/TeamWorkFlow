import { canInvite } from './invitation-policy';

// Covers: S4.1
describe('canInvite (AGENTS roles table)', () => {
  const TENANT = '0199b7e0-0000-7000-8000-000000000002';

  it.each([
    ['owner', 'admin', true],
    ['owner', 'supervisor', true],
    ['owner', 'employee', true],
    ['admin', 'admin', false],
    ['admin', 'supervisor', true],
    ['admin', 'employee', true],
    ['supervisor', 'admin', false],
    ['supervisor', 'supervisor', false],
    ['supervisor', 'employee', false],
    ['employee', 'admin', false],
    ['employee', 'supervisor', false],
    ['employee', 'employee', false],
    ['platform_admin', 'admin', false],
    ['platform_admin', 'supervisor', false],
    ['platform_admin', 'employee', false],
  ] as const)('%s inviting %s -> %s', (actorRole, role, expected) => {
    expect(canInvite({ tenantId: TENANT, role: actorRole }, role)).toBe(
      expected,
    );
  });

  it('refuses an actor without a tenant whatever the role', () => {
    expect(canInvite({ tenantId: null, role: 'owner' }, 'employee')).toBe(
      false,
    );
  });
});
