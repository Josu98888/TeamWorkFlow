import { FormBuilder } from '@/features/tasks';

type Props = {
  searchParams: Promise<{ template?: string }>;
};

export default async function NewFormPage({ searchParams }: Props) {
  const { template } = await searchParams;
  return <FormBuilder templateId={template} />;
}