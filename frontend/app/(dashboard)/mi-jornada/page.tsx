import { MyTasksSection } from '@/features/tasks';
import { MyShiftView } from '@/features/telemetry';

export default function MyShiftPage() {
  return <MyShiftView tasksSection={<MyTasksSection />} />;
}
