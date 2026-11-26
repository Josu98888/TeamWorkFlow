import type { Metadata } from 'next';
import { LandingPage } from '@/features/landing';

// Served at `/` for visitors without a session (proxy.ts rewrites it); `/landing` also works directly.
export const metadata: Metadata = {
  title: 'TeamWorkFlow · Control de asistencia y turnos para empresas con muchas sedes',
  description:
    'Fichadas con GPS o QR, turnos sin grupos de WhatsApp, alertas de llegadas tarde y horas calculadas solas. Probá 14 días gratis.',
  openGraph: {
    title: 'TeamWorkFlow',
    description: 'Dejá de llamar sede por sede para saber quién llegó. Probá 14 días gratis.',
    type: 'website',
    locale: 'es_AR',
  },
};

export default function Landing() {
  return <LandingPage />;
}
