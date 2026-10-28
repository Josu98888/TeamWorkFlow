import { Module } from '@nestjs/common';
import { AttendancePrismaModule } from './prisma/attendance-prisma.module';

@Module({
  imports: [AttendancePrismaModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
