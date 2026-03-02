import { UserDetail } from '@client/components/UserDetail';

interface UserDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function UserDetailPage({
  params,
}: UserDetailPageProps) {
  const { id } = await params;
  return <UserDetail userId={id} />;
}
