import {
  CONSUMED_SUBJECTS,
  NOTIFICATIONS_DURABLE_CONSUMERS,
  NOTIFICATIONS_EVENTS,
  notificationsEventSubject,
  subjectMatches,
  tenantIdFromSubject,
} from './notifications.events';

describe('notifications.events', () => {
  it('builds t.<tenant>.notifications.send subject', () => {
    expect(
      notificationsEventSubject('tenant-123', NOTIFICATIONS_EVENTS.send),
    ).toBe('t.tenant-123.notifications.send');
  });

  it('rejects invalid tenant ids when building subjects', () => {
    expect(() =>
      notificationsEventSubject('tenant.bad', NOTIFICATIONS_EVENTS.send),
    ).toThrow('Invalid tenant id');
    expect(() =>
      notificationsEventSubject('tenant *', NOTIFICATIONS_EVENTS.send),
    ).toThrow('Invalid tenant id');
  });

  it('extracts tenantId from event subject', () => {
    expect(tenantIdFromSubject('t.abc-123.billing.plan_changed')).toBe(
      'abc-123',
    );
    expect(tenantIdFromSubject('other.abc.notifications.send')).toBeNull();
  });

  it('matches JetStream wildcard subjects accurately', () => {
    expect(
      subjectMatches(
        CONSUMED_SUBJECTS.notificationsSend,
        't.tenant-1.notifications.send',
      ),
    ).toBe(true);
    expect(
      subjectMatches(
        CONSUMED_SUBJECTS.attendanceAlertOpened,
        't.tenant-1.attendance.alert_opened',
      ),
    ).toBe(true);
    expect(
      subjectMatches(
        CONSUMED_SUBJECTS.tasksTaskAssigned,
        't.tenant-1.tasks.task_completed',
      ),
    ).toBe(false);
    expect(subjectMatches('t.*.notifications.>', 't.tenant-1.notifications.send')).toBe(
      true,
    );
  });

  it('declares all required durable consumers across streams', () => {
    const names = NOTIFICATIONS_DURABLE_CONSUMERS.map((spec) => spec.durable);
    expect(names).toEqual([
      'notifications-generic',
      'notifications-telemetry',
      'notifications-tasks',
      'notifications-auth',
      'notifications-billing',
    ]);
  });
});
