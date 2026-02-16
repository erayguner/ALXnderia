import { PersonDetail } from '@client/components/PersonDetail';

interface PersonDetailPageProps {
  params: Promise<{
    id: string;
  }>;
}

export default async function PersonDetailPage({
  params,
}: PersonDetailPageProps) {
  const { id } = await params;
  return <PersonDetail personId={id} />;
}
