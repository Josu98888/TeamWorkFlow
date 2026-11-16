import { formatRelative } from '@/shared/lib/format';
import type { AppNotification } from '../types';

type NotificationItemProps = {
  notification: AppNotification;
  /** Omitted when the item is already read. */
  onMarkRead?: (id: string) => void;
  disabled?: boolean;
};

/** One notification row, shared by the topbar dropdown and the full page. */
export function NotificationItem({ notification, onMarkRead, disabled }: NotificationItemProps) {
  const unread = notification.readAt === null;
  return (
    <li className={`flex items-start gap-3 px-4 py-3 ${unread ? 'bg-alt' : ''}`}>
      <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${unread ? 'bg-info' : 'bg-disabled'}`} />
      <div className="min-w-0 flex-1">
        <p className={`text-sm text-title ${unread ? 'font-semibold' : 'font-medium'}`}>{notification.title}</p>
        <p className="mt-0.5 text-xs text-body">{notification.body}</p>
        <p className="mt-1 text-[11px] text-muted">{formatRelative(notification.createdAt)}</p>
      </div>
      {unread && onMarkRead && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onMarkRead(notification.id)}
          aria-label={`Marcar como leída: ${notification.title}`}
          className="shrink-0 cursor-pointer text-[11px] font-semibold text-link hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          Marcar leída
        </button>
      )}
    </li>
  );
}
