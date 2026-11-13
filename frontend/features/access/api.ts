import { USE_MOCKS } from '@/shared/lib/config';
import { accessHttpApi } from './http';
import { accessMockApi } from './mock';
import type {
  AssignableRole,
  CreatedInvitation,
  CreatedPasswordReset,
  CreateInvitationInput,
  Ok,
  PendingInvitation,
} from './types';

/** Contract of the users & access domain. Core has no "list users" endpoint: user actions need a user id. */
export type AccessApi = {
  listInvitations: () => Promise<PendingInvitation[]>;
  createInvitation: (input: CreateInvitationInput) => Promise<CreatedInvitation>;
  regenerateInvitation: (invitationId: string) => Promise<CreatedInvitation>;
  changeUserRole: (userId: string, role: AssignableRole) => Promise<Ok>;
  /** Replaces the FULL set of sites of the user. */
  assignUserSites: (userId: string, siteIds: string[]) => Promise<Ok>;
  deactivateUser: (userId: string) => Promise<Ok>;
  createPasswordReset: (userId: string) => Promise<CreatedPasswordReset>;
};

export const accessApi: AccessApi = USE_MOCKS ? accessMockApi : accessHttpApi;
