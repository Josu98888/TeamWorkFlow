'use client';

import { useEffect, useRef, useState } from 'react';
import { AuthShell } from './AuthShell';
import { LoginForm } from './LoginForm';
import { RegisterForm } from './RegisterForm';

export type AuthView = 'login' | 'register';

const PATHS: Record<AuthView, string> = { login: '/login', register: '/register' };

/**
 * Login and register in one card: a violet panel slides between the two forms.
 * The hidden form is inert, the URL follows the view without a reload and focus
 * moves to the first field of the visible form.
 */
export function AuthSlider({ initialView }: { initialView: AuthView }) {
  const [view, setView] = useState<AuthView>(initialView);
  const loginBox = useRef<HTMLDivElement>(null);
  const registerBox = useRef<HTMLDivElement>(null);
  const changed = useRef(false);

  useEffect(() => {
    if (!changed.current) return;
    const box = view === 'login' ? loginBox.current : registerBox.current;
    box?.querySelector('input')?.focus({ preventScroll: true });
  }, [view]);

  const show = (next: AuthView) => {
    changed.current = true;
    setView(next);
    window.history.replaceState(null, '', PATHS[next]);
  };

  const isRegister = view === 'register';

  return (
    <AuthShell>
      <div className="auth-glass auth-slider" data-view={view}>
        <div ref={registerBox} className="auth-form-box auth-signup" inert={!isRegister} aria-hidden={!isRegister}>
          <RegisterForm />
        </div>
        <div ref={loginBox} className="auth-form-box auth-signin" inert={isRegister} aria-hidden={isRegister}>
          <LoginForm />
        </div>

        <div className="auth-toggle-box">
          <div className="auth-toggle">
            <div className="auth-panel auth-panel-login" inert={!isRegister} aria-hidden={!isRegister}>
              <h2>¡Bienvenido de nuevo!</h2>
              <span className="auth-bar" />
              <p>¿Ya tenés cuenta? Entrá para ver tus sedes, turnos y la Torre de Control.</p>
              <button type="button" className="auth-ghost" onClick={() => show('login')}>
                Iniciar sesión
              </button>
            </div>
            <div className="auth-panel auth-panel-register" inert={isRegister} aria-hidden={isRegister}>
              <h2>¡Hola!</h2>
              <span className="auth-bar" />
              <p>¿Tu empresa todavía no usa TeamWorkFlow? Creá tu cuenta en un minuto.</p>
              <button type="button" className="auth-ghost" onClick={() => show('register')}>
                Registrarme
              </button>
            </div>
          </div>
        </div>
      </div>
    </AuthShell>
  );
}
