import type { Metadata } from 'next';
import { LegalPage } from '@/features/landing';

export const metadata: Metadata = { title: 'Política de privacidad · TeamWorkFlow' };

export default function PrivacyPage() {
  return <LegalPage title="Política de privacidad" />;
}
