import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { NatsModule } from './transport/nats.module';

@Module({
  imports: [AuthModule, NatsModule],
})
export class AppModule {}
