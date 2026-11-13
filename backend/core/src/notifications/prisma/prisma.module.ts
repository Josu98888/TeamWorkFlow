import { Module } from '@nestjs/common';
import { NotificationsPrismaService } from './prisma.service';

@Module({
  providers: [NotificationsPrismaService],
  exports: [NotificationsPrismaService],
})
export class NotificationsPrismaModule {}
