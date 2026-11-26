import Link from 'next/link';
import type { ReactNode } from 'react';
import '../landing.css';
import {
  ABOUT_TEXT,
  FAQ,
  FEATURES,
  FOUNDATION_LOGO,
  LANDING_CONTACT,
  LANDING_PATHS,
  NAV_LINKS,
  PAINS,
  PLANS,
  STEPS,
  TEAM,
} from '../content';
import { CompareSlider } from './CompareSlider';
import { LandingVideo } from './LandingVideo';
import { ChatBubbleIcon, MenuIcon, PainIconSvg, PlayIcon } from './icons';

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

function Logo() {
  return (
    <Link href="/" className="lp-logo" aria-label="TeamWorkFlow, inicio">
      <i aria-hidden="true" />
      <i aria-hidden="true" />
      TeamWorkFlow
    </Link>
  );
}

/** Dark page with the auth background shapes, navbar and footer. Shared by the landing and the legal pages. */
export function LandingShell({ children, withSections = true }: { children: ReactNode; withSections?: boolean }) {
  const prefix = withSections ? '' : '/';
  return (
    <div className="lp">
      <div className="lp-bg" aria-hidden="true">
        <span className="lp-shape lp-line" />
        <span className="lp-shape lp-line lp-line-b" />
        <span className="lp-shape lp-rod-1" />
        <span className="lp-shape lp-rod-2" />
        <span className="lp-shape lp-ring-1" />
        <span className="lp-shape lp-ring-2" />
      </div>

      <header className="lp-nav">
        <nav className="lp-nav-inner" aria-label="Principal">
          <Logo />
          <div className="lp-nav-links">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={`${prefix}${l.href}`}>
                {l.label}
              </a>
            ))}
          </div>
          <div className="lp-nav-actions">
            <Link href={LANDING_PATHS.login} className="lp-btn lp-btn-outline lp-nav-login">
              Ingresar
            </Link>
            <Link href={LANDING_PATHS.register} className="lp-btn lp-btn-primary">
              <span className="lp-long">Probá 14 días gratis</span>
              <span className="lp-short">Probá gratis</span>
            </Link>
            <details className="lp-menu">
              <summary aria-label="Abrir menú">
                <MenuIcon />
              </summary>
              <div className="lp-menu-panel">
                {NAV_LINKS.map((l) => (
                  <a key={l.href} href={`${prefix}${l.href}`}>
                    {l.label}
                  </a>
                ))}
                <Link href={LANDING_PATHS.login}>Ingresar</Link>
              </div>
            </details>
          </div>
        </nav>
      </header>

      <main style={{ position: 'relative', zIndex: 1 }}>{children}</main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <Logo />
          <nav aria-label="Legal">
            <Link href={LANDING_PATHS.terms}>Términos y condiciones</Link>
            <Link href={LANDING_PATHS.privacy}>Política de privacidad</Link>
            <a href={`mailto:${LANDING_CONTACT.email}`}>{LANDING_CONTACT.email}</a>
          </nav>
          <span>© {new Date().getFullYear()} TeamWorkFlow · Hecho en la beca IntegrarTEC</span>
        </div>
      </footer>

      <a href={LANDING_CONTACT.whatsappUrl} className="lp-float" target="_blank" rel="noopener noreferrer" aria-label="Escribinos por WhatsApp">
        <ChatBubbleIcon />
        <span className="lp-long">Escribinos</span>
      </a>
    </div>
  );
}

/** Public landing page: customer acquisition, every CTA leads to the registration. */
export function LandingPage() {
  return (
    <LandingShell>
      {/* Hero */}
      <section id="inicio" className="lp-container lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-pill">Para empresas con personal en muchas sedes</span>
          <h1 className="lp-h1">
            Dejá de llamar sede por sede para saber <span>quién llegó</span>.
          </h1>
          <p className="lp-lead">
            Fichadas con GPS o QR, turnos sin grupos de WhatsApp, alertas cuando alguien no llega y las horas del mes
            calculadas solas. Todo en una sola app.
          </p>
          <div className="lp-actions">
            <Link href={LANDING_PATHS.register} className="lp-btn lp-btn-primary lp-btn-lg">
              Probá 14 días gratis
            </Link>
            <a href="#video" className="lp-btn lp-btn-outline lp-btn-lg">
              <PlayIcon /> Ver el video
            </a>
          </div>
          <p className="lp-note">Configurás tus sedes en minutos · Cancelás cuando quieras</p>
        </div>
        <LandingVideo />
      </section>

      <CompareSlider />

      {/* Problem */}
      <section id="problema" className="lp-container">
        <p className="lp-eyebrow">¿TE SUENA?</p>
        <h2 className="lp-h2">Coordinar gente en muchas sedes no debería ser un segundo trabajo.</h2>
        <div className="lp-grid">
          {PAINS.map((p) => (
            <article key={p.title} className="lp-card lp-pain">
              <PainIconSvg icon={p.icon} />
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="funciones" className="lp-container">
        <p className="lp-eyebrow">LA SOLUCIÓN</p>
        <h2 className="lp-h2">
          Todo lo que hoy hacés a mano, en <span className="lp-mark">un solo lugar</span>.
        </h2>
        <div className="lp-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))' }}>
          {FEATURES.map((f) => (
            <article key={f.title} className="lp-card lp-feature">
              <s>{f.before}</s>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="lp-container" aria-labelledby="lp-steps-title">
        <h2 id="lp-steps-title" className="lp-h2">
          Arrancás en 3 pasos
        </h2>
        <ol className="lp-grid lp-steps">
          {STEPS.map((s, i) => (
            <li key={s.title} className="lp-card lp-step">
              <span className="lp-step-n">{i + 1}</span>
              <div>
                <strong style={{ fontSize: 18 }}>{s.title}</strong>
                <span className="lp-muted">{s.text}</span>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Plans */}
      <section id="planes" className="lp-container lp-center">
        <p className="lp-eyebrow">PLANES</p>
        <h2 className="lp-h2">Empezá gratis. Elegí después.</h2>
        <p className="lp-muted" style={{ margin: 0 }}>
          14 días de prueba · Pagás por Mercado Pago o transferencia
        </p>
        <div className="lp-plans" style={{ textAlign: 'left' }}>
          {PLANS.map((p) => (
            <article key={p.name} className={`lp-card lp-plan${p.featured ? ' lp-plan-featured' : ''}`}>
              {p.featured && <span className="lp-plan-badge">RECOMENDADO</span>}
              <h3>{p.name}</h3>
              <p>{p.tagline}</p>
              <p className="lp-price">
                <strong>{p.price}</strong> <span className="lp-muted">/mes</span>
              </p>
              <ul>
                {p.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link
                href={LANDING_PATHS.register}
                className={`lp-btn ${p.featured ? 'lp-btn-primary' : 'lp-btn-outline'}`}
              >
                {p.featured ? 'Probá 14 días gratis' : 'Empezar prueba'}
              </Link>
            </article>
          ))}
        </div>
      </section>

      {/* About */}
      <section id="nosotros" className="lp-container lp-about">
        <div className="lp-about-copy">
          <p className="lp-eyebrow" style={{ margin: 0 }}>
            QUIÉNES SOMOS
          </p>
          <h2 className="lp-h2">Tres estudiantes de la beca IntegrarTEC</h2>
          <p>{ABOUT_TEXT}</p>
          <div className="lp-foundation">
            {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
            <img src={FOUNDATION_LOGO} alt="Logo de la fundación" width={64} height={64} />
            <span>Con el apoyo de la fundación de la beca IntegrarTEC</span>
          </div>
        </div>
        <div className="lp-team">
          {TEAM.map((m) => (
            <div key={m.name} className="lp-card lp-member">
              {m.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- small static photo
                <img className="lp-avatar" src={m.photo} alt={`Foto de ${m.name}`} width={76} height={76} />
              ) : (
                <span className="lp-avatar" aria-hidden="true">
                  {initials(m.name)}
                </span>
              )}
              <strong>{m.name}</strong>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="lp-container lp-faq">
        <h2 className="lp-h2">Preguntas frecuentes</h2>
        <div className="lp-faq-list">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Final CTA */}
      <section className="lp-container" style={{ paddingTop: 40 }}>
        <div className="lp-cta">
          <h2>El próximo lunes a las 8:05, enterate antes que el cliente.</h2>
          <p>Creá tu cuenta en un minuto. 14 días gratis.</p>
          <Link href={LANDING_PATHS.register} className="lp-btn lp-btn-primary lp-btn-lg">
            Registrarme gratis
          </Link>
        </div>
      </section>
    </LandingShell>
  );
}

/** Placeholder for the legal pages until the final text is ready. */
export function LegalPage({ title }: { title: string }) {
  return (
    <LandingShell withSections={false}>
      <section className="lp-container lp-legal">
        <h1 className="lp-h2">{title}</h1>
        {/* TODO(landing): final legal text (privacy must cover Ley 25.326: GPS location and employee data). */}
        <p>Estamos terminando este documento. Si tenés dudas, escribinos a {LANDING_CONTACT.email}.</p>
      </section>
    </LandingShell>
  );
}
