// Emails are stored trimmed and lowercased (AGENTS § Tenants and registration).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
