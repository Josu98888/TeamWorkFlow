import { PostScheduleView } from '@/features/organization';

export default async function TurnosPostPage({
  params,
}: {
  params: Promise<{ siteId: string; postId: string }>;
}) {
  const { siteId, postId } = await params;
  return <PostScheduleView siteId={siteId} postId={postId} />;
}
