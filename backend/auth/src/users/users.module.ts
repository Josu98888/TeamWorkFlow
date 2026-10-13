import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { UserAssignSitesService } from './user-assign-sites.service';
import { UserChangeRoleService } from './user-change-role.service';
import { UserDeactivateService } from './user-deactivate.service';
import { UsersController } from './users.controller';

@Module({
  imports: [EventsModule],
  controllers: [UsersController],
  providers: [
    UserChangeRoleService,
    UserAssignSitesService,
    UserDeactivateService,
  ],
})
export class UsersModule {}
