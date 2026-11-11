// Mirrors the `auth` module of `core` (invitations, users and password-reset controllers/DTOs).

/** Roles that can be invited or assigned (never owner or platform_admin). */
export const ASSIGNABLE_ROLES = ['admin', 'supervisor', 'employee'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** `GET /auth/invitations`: pending invitations only. */
export type PendingInvitation = {
  invitationId: string;
  email: string;
  role: AssignableRole;
  expiresAt: string;
};

/** `POST /auth/invitations` and `.../:invitationId/regenerate`. The raw token is returned only once. */
export type CreatedInvitation = {
  invitationId: string;
  token: string;
  expiresAt: string;
};

export type CreateInvitationInput = { email: string; role: AssignableRole };

/** `POST /auth/users/:userId/password-reset`. The raw token is returned only once. */
export type CreatedPasswordReset = { token: string; expiresAt: string };

export type Ok = { ok: true };
