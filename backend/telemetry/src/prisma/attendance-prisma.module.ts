import { Global, Module } from '@nestjs/common';
import { AttendancePrismaService } from './attendance-prisma.service';

@Global()
@Module({
  providers: [AttendancePrismaService],
  exports: [AttendancePrismaService],
})
export class AttendancePrismaModule {}
