import { AcceptInvitationForm } from '@/features/access/components/PublicTokenForms';

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <AcceptInvitationForm token={token} />;
}
