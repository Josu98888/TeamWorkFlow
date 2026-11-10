import { apiFetch } from '@/shared/lib/http';
import type { OrganizationApi } from './api';
import type { ListEmployeesQuery, ListShiftsQuery, ListSitesQuery } from './types';

function toQueryString(query: ListSitesQuery | ListEmployeesQuery | ListShiftsQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

const send = <T>(path: string, method: 'POST' | 'PATCH', body: unknown) =>
  apiFetch<T>(path, { method, body: JSON.stringify(body) });

/** Real implementation against `core` (`/api/v1/...`). Same contract as the mock. */
export const organizationHttpApi: OrganizationApi = {
  listSites: (query = {}) => apiFetch(`/sites${toQueryString(query)}`),
  getSite: (siteId) => apiFetch(`/sites/${siteId}`),
  listPosts: (siteId) => apiFetch(`/sites/${siteId}/posts`),
  listEmployees: (query = {}) => apiFetch(`/employees${toQueryString(query)}`),
  listShifts: (query = {}) => apiFetch(`/shifts${toQueryString(query)}`),
  createSite: (input) => send('/sites', 'POST', input),
  updateSite: (siteId, input) => send(`/sites/${siteId}`, 'PATCH', input),
  rotateSiteQr: (siteId) => send(`/sites/${siteId}/rotate-qr`, 'POST', {}),
  createPost: (siteId, input) => send(`/sites/${siteId}/posts`, 'POST', input),
  updatePost: (postId, input) => send(`/posts/${postId}`, 'PATCH', input),
  createEmployee: (input) => send('/employees', 'POST', input),
  updateEmployee: (employeeId, input) => send(`/employees/${employeeId}`, 'PATCH', input),
  createShift: (input) => send('/shifts', 'POST', input),
  updateShift: (shiftId, input) => send(`/shifts/${shiftId}`, 'PATCH', input),
  reassignShift: (shiftId, input) => send(`/shifts/${shiftId}/reassign`, 'POST', input),
  cancelShift: (shiftId, input) => send(`/shifts/${shiftId}/cancel`, 'POST', input),
};
