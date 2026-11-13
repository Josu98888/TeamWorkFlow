import { apiFetch } from '@/shared/lib/http';
import type { AccessApi } from './api';

const post = <T>(path: string, body: unknown = {}) => apiFetch<T>(path, { method: 'POST', body: JSON.stringify(body) });

/** Real implementation against `core` (`/api/v1/auth/...`). Same contract as the mock. */
export const accessHttpApi: AccessApi = {
  listInvitations: () => apiFetch('/auth/invitations'),
  createInvitation: (input) => post('/auth/invitations', input),
  regenerateInvitation: (invitationId) => post(`/auth/invitations/${invitationId}/regenerate`),
  changeUserRole: (userId, role) => apiFetch(`/auth/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
  assignUserSites: (userId, siteIds) => apiFetch(`/auth/users/${userId}/sites`, { method: 'PUT', body: JSON.stringify({ siteIds }) }),
  deactivateUser: (userId) => post(`/auth/users/${userId}/deactivate`),
  createPasswordReset: (userId) => post(`/auth/users/${userId}/password-reset`),
};
