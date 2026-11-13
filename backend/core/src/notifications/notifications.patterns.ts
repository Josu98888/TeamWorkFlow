// Operation names of the notifications module (AGENTS § NATS Contract).
// In `core` they are in-process facade calls; notifications answers no NATS requests.
export const NOTIFICATIONS_PATTERNS = {
  pushTokenRegister: 'notifications.push-token.register',
  pushTokenUnregister: 'notifications.push-token.unregister',
  notificationList: 'notifications.notification.list',
  notificationUnreadCount: 'notifications.notification.unread-count',
  notificationMarkRead: 'notifications.notification.mark-read',
} as const;

export type NotificationsPattern =
  (typeof NOTIFICATIONS_PATTERNS)[keyof typeof NOTIFICATIONS_PATTERNS];

// Cross-module facade operations used by the notification router.
export const AUTH_USER_LIST_RECIPIENTS_PATTERN = 'auth.user.list-recipients';
export const ORGANIZATION_EMPLOYEE_GET_PATTERN = 'organization.employee.get';

export const NOTIFICATIONS_MODULE = 'notifications';

// Stream owned by notifications: captures generic notification send requests.
export const NOTIFICATIONS_STREAM = 'NOTIFICATIONS_EVENTS';
export const NOTIFICATIONS_STREAM_SUBJECTS = `t.*.${NOTIFICATIONS_MODULE}.>`;
