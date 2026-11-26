import type { Metadata } from 'next';
import { LegalPage } from '@/features/landing';

export const metadata: Metadata = { title: 'Términos y condiciones · TeamWorkFlow' };

export default function TermsPage() {
  return <LegalPage title="Términos y condiciones" />;
}
