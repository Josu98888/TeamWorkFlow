import { Plan, Role, TenantStatus } from '../generated/prisma/enums';
import {
  fromWirePlan,
  fromWireRole,
  toWirePlan,
  toWireRole,
  toWireTenantStatus,
} from './wire';

// Covers: S3.3
describe('wire values', () => {
  const roles = [
    ['OWNER', 'owner'],
    ['ADMIN', 'admin'],
    ['SUPERVISOR', 'supervisor'],
    ['EMPLOYEE', 'employee'],
    ['PLATFORM_ADMIN', 'platform_admin'],
  ] as const;
  const statuses = [
    ['ACTIVE', 'active'],
    ['PAST_DUE', 'past_due'],
    ['SUSPENDED', 'suspended'],
    ['CANCELLED', 'cancelled'],
    ['DELETED', 'deleted'],
  ] as const;
  const plans = [
    ['BASIC', 'basic'],
    ['PRO', 'pro'],
  ] as const;

  it.each(roles)('maps role %s to %s and back', (prisma, wire) => {
    expect(toWireRole(prisma)).toBe(wire);
    expect(fromWireRole(wire)).toBe(prisma);
  });

  it.each(statuses)('maps tenant status %s to %s', (prisma, wire) => {
    expect(toWireTenantStatus(prisma)).toBe(wire);
  });

  it.each(plans)('maps plan %s to %s and back', (prisma, wire) => {
    expect(toWirePlan(prisma)).toBe(wire);
    expect(fromWirePlan(wire)).toBe(prisma);
  });

  it('covers every Prisma enum value', () => {
    expect(roles.map(([p]) => p).sort()).toEqual(Object.values(Role).sort());
    expect(statuses.map(([p]) => p).sort()).toEqual(
      Object.values(TenantStatus).sort(),
    );
    expect(plans.map(([p]) => p).sort()).toEqual(Object.values(Plan).sort());
  });
});
