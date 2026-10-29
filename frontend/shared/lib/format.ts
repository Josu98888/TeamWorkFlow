const LOCALE = 'es-AR';

const timeFormat = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hour12: false });
const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: '2-digit', month: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const longDateFormat = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });

export const formatTime = (iso: string) => timeFormat.format(new Date(iso));
export const formatDate = (iso: string) => dateFormat.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFormat.format(new Date(iso));
export const formatLongDate = (date: Date = new Date()) => longDateFormat.format(date);

/** "hace 5 min", "hace 2 h", "hace 3 d". */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return `hace ${Math.round(hours / 24)} d`;
}

export const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export function formatMeters(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

export function formatCoordinates(latitude: number, longitude: number): string {
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

export const fullName = (person: { firstName: string; lastName: string }) =>
  `${person.firstName} ${person.lastName}`;

export const initials = (person: { firstName: string; lastName: string }) =>
  `${person.firstName[0] ?? ''}${person.lastName[0] ?? ''}`.toUpperCase();
