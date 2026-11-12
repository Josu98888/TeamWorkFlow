// Request-reply contract of the auth service (AGENTS § Request-reply).
// Single source of the pattern names inside `auth`; the gateway keeps a mirror
// with only the patterns it calls.
export const AUTH_PATTERNS = {
  register: 'auth.register',
  login: 'auth.login',
  logout: 'auth.logout',
  tokenRefresh: 'auth.token.refresh',
  tokenVerify: 'auth.token.verify',
  invitationCreate: 'auth.invitation.create',
  invitationList: 'auth.invitation.list',
  invitationRegenerate: 'auth.invitation.regenerate',
  invitationAccept: 'auth.invitation.accept',
  userChangeRole: 'auth.user.change-role',
  userAssignSites: 'auth.user.assign-sites',
  userDeactivate: 'auth.user.deactivate',
  // Internal services only (e.g. notifications); never exposed by the gateway.
  userListRecipients: 'auth.user.list-recipients',
  passwordResetCreate: 'auth.password-reset.create',
  passwordResetConfirm: 'auth.password-reset.confirm',
} as const;

export type AuthPattern = (typeof AUTH_PATTERNS)[keyof typeof AUTH_PATTERNS];
