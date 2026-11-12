import { Module } from '@nestjs/common';
import { ShiftSnapshotService } from './shift-snapshot.service';

@Module({
  providers: [ShiftSnapshotService],
  exports: [ShiftSnapshotService],
})
export class ShiftsModule {}
