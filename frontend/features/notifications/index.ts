// Public API of the notifications domain (client-safe).
export { notificationsApi } from './api';
export { NotificationBell } from './components/NotificationBell';
export { NotificationsView } from './components/NotificationsView';
export type { AppNotification } from './types';
export { useUnreadCount } from './useUnreadCount';
