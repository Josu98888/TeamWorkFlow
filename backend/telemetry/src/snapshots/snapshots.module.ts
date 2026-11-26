import { Module } from '@nestjs/common';
import { NatsModule } from '../nats/nats.module';
import { AttendancePrismaModule } from '../prisma/attendance-prisma.module';
import { OrgSnapshotsService } from './org-snapshots.service';

@Module({
  imports: [AttendancePrismaModule, NatsModule],
  providers: [OrgSnapshotsService],
  exports: [OrgSnapshotsService],
})
export class SnapshotsModule {}
