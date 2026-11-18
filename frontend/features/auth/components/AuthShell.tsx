import type { ReactNode } from 'react';
import '../auth.css';

/** Always-dark page background with the geometric shapes; wraps every public auth screen. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth-screen">
      <div className="auth-bg" aria-hidden="true">
        <span className="auth-shape auth-line" />
        <span className="auth-shape auth-line auth-line-b" />
        <span className="auth-shape auth-rod-1 auth-float" />
        <span className="auth-shape auth-rod-2 auth-float-slow" />
        <span className="auth-shape auth-rod-3" />
        <span className="auth-shape auth-ring auth-ring-1 auth-float-slow" />
        <span className="auth-shape auth-ring auth-ring-2" />
      </div>
      {children}
    </main>
  );
}

/** Single-column glass card for the screens that do not slide (invitation, password reset). */
export function AuthCard({ children }: { children: ReactNode }) {
  return <div className="auth-glass auth-single">{children}</div>;
}
