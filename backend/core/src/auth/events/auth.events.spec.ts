import {
  AUTH_DURABLE_CONSUMERS,
  AUTH_EVENTS,
  AUTH_STREAM_SUBJECTS,
  CONSUMED_SUBJECTS,
  authEventSubject,
  subjectMatches,
  tenantIdFromSubject,
} from './auth.events';

// Covers: S1.9
describe('auth.events', () => {
  it('builds t.<tenantId>.auth.<event> for every emitted event', () => {
    for (const event of Object.values(AUTH_EVENTS)) {
      expect(authEventSubject('tenant-1', event)).toBe(
        `t.tenant-1.auth.${event}`,
      );
    }
    expect(Object.values(AUTH_EVENTS)).toHaveLength(8);
  });

  it('rejects a tenant id that would break the subject', () => {
    for (const bad of ['', 'a.b', 'a*', 'a>', 'a b']) {
      expect(() => authEventSubject(bad, AUTH_EVENTS.userCreated)).toThrow();
    }
  });

  it('captures every emitted subject in the stream', () => {
    const subject = authEventSubject('tenant-1', AUTH_EVENTS.tenantCreated);
    expect(subjectMatches(AUTH_STREAM_SUBJECTS, subject)).toBe(true);
  });

  it('filters consumed subjects for every tenant', () => {
    expect(CONSUMED_SUBJECTS.planChanged).toBe('t.*.billing.plan_changed');
    expect(CONSUMED_SUBJECTS.employeeCreated).toBe(
      't.*.organization.employee_created',
    );
    expect(Object.values(CONSUMED_SUBJECTS)).toHaveLength(9);
  });

  it('assigns each consumed subject to one durable consumer', () => {
    const byDurable = Object.fromEntries(
      AUTH_DURABLE_CONSUMERS.map((c) => [c.durable, c]),
    );
    expect(byDurable['auth-organization'].stream).toBe('ORGANIZATION_EVENTS');
    expect(byDurable['auth-billing'].stream).toBe('BILLING_EVENTS');
    const all = AUTH_DURABLE_CONSUMERS.flatMap((c) => c.filterSubjects).sort();
    expect(all).toEqual(Object.values(CONSUMED_SUBJECTS).sort());
  });

  it('reads the tenant from a subject', () => {
    expect(tenantIdFromSubject('t.abc.billing.payment_overdue')).toBe('abc');
    expect(tenantIdFromSubject('x.abc.billing.payment_overdue')).toBeNull();
  });

  it('matches concrete subjects against filters', () => {
    const filter = CONSUMED_SUBJECTS.paymentOverdue;
    expect(subjectMatches(filter, 't.abc.billing.payment_overdue')).toBe(true);
    expect(subjectMatches(filter, 't.abc.billing.plan_changed')).toBe(false);
    expect(subjectMatches(filter, 't.abc.billing.payment_overdue.x')).toBe(
      false,
    );
  });
});
