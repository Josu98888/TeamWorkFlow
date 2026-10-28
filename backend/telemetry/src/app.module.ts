import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AttendancePrismaModule } from './prisma/attendance-prisma.module';
import { NatsModule } from './nats/nats.module';
import { AuthGuard } from './http/guards/auth.guard';

@Module({
  imports: [AttendancePrismaModule, NatsModule],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
