import { PasswordResetForm } from '@/features/access/components/PublicTokenForms';

export default async function PasswordResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <PasswordResetForm token={token} />;
}
