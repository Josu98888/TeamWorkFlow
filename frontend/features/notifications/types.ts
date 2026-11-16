// Mirrors `GET /api/v1/notifications` of core (`backend/core/src/notifications/http`).
// Push tokens (`/push-tokens`) are mobile-only and not modelled here.

export type AppNotification = {
  id: string;
  templateCode: string;
  locale: string;
  title: string;
  body: string;
  /** Free-form payload of the template (ids, links); null when the template has none. */
  data: Record<string, unknown> | null;
  /** ISO instant, null while unread. */
  readAt: string | null;
  createdAt: string;
};

export type NotificationsPage = {
  items: AppNotification[];
  total: number;
  page: number;
  pageSize: number;
};

export type ListNotificationsQuery = {
  page?: number;
  pageSize?: number;
  unreadOnly?: boolean;
};

/** `POST /notifications/:id/read` (`:id` may be `all`). */
export type MarkReadResult = {
  updatedCount: number;
  id?: string;
  readAt?: string;
};
