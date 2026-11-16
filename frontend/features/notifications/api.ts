import { USE_MOCKS } from '@/shared/lib/config';
import { notificationsHttpApi } from './http';
import { notificationsMockApi } from './mock';
import type { ListNotificationsQuery, MarkReadResult, NotificationsPage } from './types';

export type NotificationsApi = {
  listNotifications: (query?: ListNotificationsQuery) => Promise<NotificationsPage>;
  getUnreadCount: () => Promise<number>;
  markRead: (id: string) => Promise<MarkReadResult>;
  markAllRead: () => Promise<MarkReadResult>;
};

// The only mock/real switch of this domain (see `shared/lib/config.ts`).
export const notificationsApi: NotificationsApi = USE_MOCKS ? notificationsMockApi : notificationsHttpApi;
