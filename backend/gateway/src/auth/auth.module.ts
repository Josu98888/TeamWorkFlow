import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { NatsModule } from '../transport/nats.module';
import { AuthGuard } from './guards/auth.guard';
import { APP_GUARD } from '@nestjs/core';

@Module({
  controllers: [AuthController],
  imports: [NatsModule],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AuthModule {}
