import { minutesFromNow, mockResponse, mockUnavailable } from '@/shared/lib/mock';
import type { AccessApi } from './api';

/** Demo data: one pending invitation; every write is unavailable (mock mode is read-only). */
export const accessMockApi: AccessApi = {
  listInvitations: () =>
    mockResponse([
      { invitationId: '00000000-0000-4000-8000-000000000001', email: 'nuevo@empresa.com', role: 'supervisor', expiresAt: minutesFromNow(60 * 24 * 3) },
    ]),
  createInvitation: mockUnavailable,
  regenerateInvitation: mockUnavailable,
  changeUserRole: mockUnavailable,
  assignUserSites: mockUnavailable,
  deactivateUser: mockUnavailable,
  createPasswordReset: mockUnavailable,
};
