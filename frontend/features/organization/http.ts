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

/** Real implementation against `core` (`/api/v1/...`). Same contract as the mock. */
export const organizationHttpApi: OrganizationApi = {
  listSites: (query = {}) => apiFetch(`/sites${toQueryString(query)}`),
  getSite: (siteId) => apiFetch(`/sites/${siteId}`),
  listPosts: (siteId) => apiFetch(`/sites/${siteId}/posts`),
  listEmployees: (query = {}) => apiFetch(`/employees${toQueryString(query)}`),
  listShifts: (query = {}) => apiFetch(`/shifts${toQueryString(query)}`),
};
