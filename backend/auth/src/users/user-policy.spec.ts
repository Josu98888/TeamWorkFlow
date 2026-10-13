import {
  canAssignSites,
  canChangeRole,
  canCreatePasswordReset,
  canDeactivate,
  canManageRole,
  isUserManager,
} from './user-policy';
import type { PolicyActor, PolicyTarget } from './user-policy';
import type { WireRole } from '../common/wire';

const TENANT_A = '0199b7e0-0000-7000-8000-00000000000a';
const TENANT_B = '0199b7e0-0000-7000-8000-00000000000b';
const ACTOR_ID = '0199b7e0-0000-7000-8000-000000000001';
const TARGET_ID = '0199b7e0-0000-7000-8000-000000000002';

const ROLES: WireRole[] = [
  'owner',
  'admin',
  'supervisor',
  'employee',
  'platform_admin',
];

function actor(role: WireRole, tenantId: string | null = TENANT_A) {
  return { userId: ACTOR_ID, tenantId, role } satisfies PolicyActor;
}

function target(role: WireRole, tenantId: string | null = TENANT_A) {
  return { userId: TARGET_ID, tenantId, role } satisfies PolicyTarget;
}

// Expected result per [actor role][target role] for a manageable action
// (deactivate, password reset), straight from the AGENTS Roles table.
const MANAGE: Record<WireRole, Partial<Record<WireRole, boolean>>> = {
  owner: { admin: true, supervisor: true, employee: true },
  admin: { supervisor: true, employee: true },
  supervisor: {},
  employee: {},
  platform_admin: {},
};

const ROLE_PAIRS = ROLES.flatMap((a) =>
  ROLES.map((t) => [a, t, MANAGE[a][t] === true] as const),
);

// Covers: S5.1
describe('user policy (AGENTS roles table)', () => {
  describe('isUserManager', () => {
    it.each([
      ['owner', true],
      ['admin', true],
      ['supervisor', false],
      ['employee', false],
      ['platform_admin', false],
    ] as const)('%s -> %s', (role, expected) => {
      expect(isUserManager({ tenantId: TENANT_A, role })).toBe(expected);
    });

    it('is false for an owner/admin without a tenant', () => {
      expect(isUserManager({ tenantId: null, role: 'owner' })).toBe(false);
      expect(isUserManager({ tenantId: null, role: 'admin' })).toBe(false);
    });
  });

  describe('canManageRole (invite / regenerate)', () => {
    it.each(ROLE_PAIRS)('%s acting on role %s -> %s', (a, t, expected) => {
      expect(canManageRole({ tenantId: TENANT_A, role: a }, t)).toBe(expected);
    });

    it('is false for any actor without a tenant', () => {
      for (const role of ROLES) {
        expect(canManageRole({ tenantId: null, role }, 'employee')).toBe(false);
      }
    });
  });

  describe.each([
    ['canDeactivate', canDeactivate],
    ['canCreatePasswordReset', canCreatePasswordReset],
  ] as const)('%s', (_name, can) => {
    it.each(ROLE_PAIRS)('%s on %s in the same tenant -> %s', (a, t, ok) => {
      expect(can(actor(a), target(t))).toBe(ok);
    });

    it('never acts on oneself', () => {
      for (const role of ['owner', 'admin'] as const) {
        expect(
          can(actor(role), { userId: ACTOR_ID, tenantId: TENANT_A, role }),
        ).toBe(false);
      }
    });

    it('is forbidden across tenants whatever the roles', () => {
      for (const a of ROLES) {
        for (const t of ROLES) {
          expect(can(actor(a, TENANT_A), target(t, TENANT_B))).toBe(false);
        }
      }
    });

    it('is forbidden when the actor or the target has no tenant', () => {
      expect(can(actor('owner', null), target('employee', null))).toBe(false);
      expect(can(actor('owner'), target('employee', null))).toBe(false);
      expect(can(actor('owner', null), target('employee'))).toBe(false);
    });
  });

  describe('canChangeRole', () => {
    it.each([
      ['owner', 'supervisor', 'employee', true],
      ['owner', 'employee', 'supervisor', true],
      ['admin', 'supervisor', 'employee', true],
      ['admin', 'employee', 'supervisor', true],
      // to or from admin: owner only
      ['owner', 'employee', 'admin', true],
      ['owner', 'supervisor', 'admin', true],
      ['owner', 'admin', 'supervisor', true],
      ['owner', 'admin', 'employee', true],
      ['admin', 'employee', 'admin', false],
      ['admin', 'supervisor', 'admin', false],
      ['admin', 'admin', 'supervisor', false],
      ['admin', 'admin', 'employee', false],
      // nobody becomes owner or platform_admin
      ['owner', 'employee', 'owner', false],
      ['owner', 'admin', 'owner', false],
      ['owner', 'employee', 'platform_admin', false],
      ['admin', 'employee', 'owner', false],
      // nobody demotes the owner or touches a platform_admin
      ['owner', 'owner', 'admin', false],
      ['owner', 'owner', 'employee', false],
      ['admin', 'owner', 'employee', false],
      ['owner', 'platform_admin', 'employee', false],
      ['admin', 'platform_admin', 'employee', false],
      // supervisor, employee and platform_admin manage nobody
      ['supervisor', 'employee', 'supervisor', false],
      ['employee', 'supervisor', 'employee', false],
      ['platform_admin', 'employee', 'supervisor', false],
    ] as const)('%s changing %s to %s -> %s', (a, current, next, expected) => {
      expect(canChangeRole(actor(a), target(current), next)).toBe(expected);
    });

    it('is forbidden on oneself', () => {
      expect(
        canChangeRole(
          actor('owner'),
          { userId: ACTOR_ID, tenantId: TENANT_A, role: 'admin' },
          'employee',
        ),
      ).toBe(false);
    });

    it('is forbidden across tenants', () => {
      expect(
        canChangeRole(actor('owner'), target('employee', TENANT_B), 'admin'),
      ).toBe(false);
      expect(
        canChangeRole(
          actor('admin', TENANT_A),
          target('supervisor', TENANT_B),
          'employee',
        ),
      ).toBe(false);
    });

    it('is forbidden without a tenant', () => {
      expect(
        canChangeRole(
          actor('owner', null),
          target('employee', null),
          'supervisor',
        ),
      ).toBe(false);
    });
  });

  describe('canAssignSites', () => {
    it.each([
      ['owner', 'supervisor', true],
      ['admin', 'supervisor', true],
      ['supervisor', 'supervisor', false],
      ['employee', 'supervisor', false],
      ['platform_admin', 'supervisor', false],
      ['owner', 'owner', false],
      ['owner', 'admin', false],
      ['owner', 'employee', false],
      ['admin', 'employee', false],
      ['owner', 'platform_admin', false],
    ] as const)('%s on %s -> %s', (a, t, expected) => {
      expect(canAssignSites(actor(a), target(t))).toBe(expected);
    });

    it('is forbidden across tenants', () => {
      expect(
        canAssignSites(actor('owner'), target('supervisor', TENANT_B)),
      ).toBe(false);
      expect(
        canAssignSites(actor('admin'), target('supervisor', TENANT_B)),
      ).toBe(false);
    });

    it('is forbidden on oneself', () => {
      expect(
        canAssignSites(actor('admin'), {
          userId: ACTOR_ID,
          tenantId: TENANT_A,
          role: 'supervisor',
        }),
      ).toBe(false);
    });
  });
});
