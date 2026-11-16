import { apiFetch } from '@/shared/lib/http';
import type { NotificationsApi } from './api';

/** Real implementation against `core` (`/api/v1/notifications`), any signed-in tenant role. */
export const notificationsHttpApi: NotificationsApi = {
  listNotifications: ({ page, pageSize, unreadOnly } = {}) => {
    const search = new URLSearchParams();
    if (page) search.set('page', String(page));
    if (pageSize) search.set('pageSize', String(pageSize));
    if (unreadOnly) search.set('unreadOnly', 'true');
    const text = search.toString();
    return apiFetch(`/notifications${text ? `?${text}` : ''}`);
  },
  getUnreadCount: async () => (await apiFetch<{ count: number }>('/notifications/unread-count')).count,
  markRead: (id) => apiFetch(`/notifications/${id}/read`, { method: 'POST', body: JSON.stringify({}) }),
  markAllRead: () => apiFetch('/notifications/all/read', { method: 'POST', body: JSON.stringify({}) }),
};
