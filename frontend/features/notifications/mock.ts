import { minutesFromNow, mockResponse } from '@/shared/lib/mock';
import { mockId } from '@/shared/mocks/world';
import type { NotificationsApi } from './api';
import type { AppNotification } from './types';

const SEEDS: readonly { code: string; title: string; body: string; minutesAgo: number; read: boolean }[] = [
  { code: 'task.expired', title: 'Tarea vencida', body: 'La tarea "Revisión de iluminación perimetral" venció sin completarse.', minutesAgo: 12, read: false },
  { code: 'alert.late_arrival', title: 'Llegada tardía', body: 'Un empleado fichó con retraso en Planta Norte Pilar.', minutesAgo: 55, read: false },
  { code: 'shift.assigned', title: 'Nuevo turno asignado', body: 'Se te asignó un turno para mañana en Centro Logístico Zárate.', minutesAgo: 180, read: false },
  { code: 'task.completed', title: 'Tarea completada', body: 'Se completó "Control de acceso de proveedores".', minutesAgo: 420, read: true },
  { code: 'billing.invoice_issued', title: 'Nueva factura emitida', body: 'Ya está disponible la factura del período actual.', minutesAgo: 1500, read: true },
];

// Mutable on purpose: marking as read must be visible to later calls during the demo session.
const STATE: AppNotification[] = SEEDS.map((seed, index) => ({
  id: mockId(9, index + 1),
  templateCode: seed.code,
  locale: 'es',
  title: seed.title,
  body: seed.body,
  data: null,
  readAt: seed.read ? minutesFromNow(-seed.minutesAgo + 5) : null,
  createdAt: minutesFromNow(-seed.minutesAgo),
}));

export const notificationsMockApi: NotificationsApi = {
  listNotifications: ({ page = 1, pageSize = 20, unreadOnly = false } = {}) => {
    const rows = STATE.filter((item) => !unreadOnly || item.readAt === null);
    const start = (page - 1) * pageSize;
    return mockResponse({ items: rows.slice(start, start + pageSize), total: rows.length, page, pageSize });
  },
  getUnreadCount: () => mockResponse(STATE.filter((item) => item.readAt === null).length),
  markRead: (id) => {
    const target = STATE.find((item) => item.id === id && item.readAt === null);
    if (target) target.readAt = new Date().toISOString();
    return mockResponse({ updatedCount: target ? 1 : 0, id, readAt: target?.readAt ?? undefined });
  },
  markAllRead: () => {
    const unread = STATE.filter((item) => item.readAt === null);
    const now = new Date().toISOString();
    for (const item of unread) item.readAt = now;
    return mockResponse({ updatedCount: unread.length });
  },
};
