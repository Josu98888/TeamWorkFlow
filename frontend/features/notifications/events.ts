/** Fired after any read-state mutation so the bell refreshes its unread count without waiting for the poll. */
export const NOTIFICATIONS_CHANGED_EVENT = 'tw:notifications-changed';

export function announceNotificationsChanged(): void {
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}
