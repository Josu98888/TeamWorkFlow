import { SiteDetailView } from '@/features/organization';

export default async function SiteDetailPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  return <SiteDetailView siteId={siteId} />;
}
