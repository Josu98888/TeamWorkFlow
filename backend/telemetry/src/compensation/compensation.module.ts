import { Module } from '@nestjs/common';
import { AttendancePrismaModule } from '../prisma/attendance-prisma.module';
import { SnapshotsModule } from '../snapshots/snapshots.module';
import { CompensationController } from './compensation.controller';
import { CompensationService } from './compensation.service';

@Module({
  imports: [AttendancePrismaModule, SnapshotsModule],
  controllers: [CompensationController],
  providers: [CompensationService],
  exports: [CompensationService],
})
export class CompensationModule {}
