import { FormBuilder } from '@/features/tasks';

export default async function EditFormPage({ params }: { params: Promise<{ formId: string }> }) {
  const { formId } = await params;
  return <FormBuilder formId={formId} />;
}
