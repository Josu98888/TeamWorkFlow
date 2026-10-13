import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EventsModule } from '../events/events.module';
import { EmployeeCreatedHandlers } from './employee-created.handlers';
import { InvitationAcceptService } from './invitation-accept.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [AuthModule, EventsModule],
  controllers: [InvitationsController],
  providers: [
    InvitationsService,
    InvitationAcceptService,
    EmployeeCreatedHandlers,
  ],
})
export class InvitationsModule {}
