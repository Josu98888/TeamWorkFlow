import { SitePostsFolderView } from '@/features/organization';

export default async function TurnosSitePage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <SitePostsFolderView siteId={siteId} />;
}
