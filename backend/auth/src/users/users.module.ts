import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { UserChangeRoleService } from './user-change-role.service';
import { UsersController } from './users.controller';

@Module({
  imports: [EventsModule],
  controllers: [UsersController],
  providers: [UserChangeRoleService],
})
export class UsersModule {}
