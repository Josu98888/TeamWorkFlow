import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { envs } from '../config';
import { AuthTokenResponder } from './auth-token.responder';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConsumedEventProcessor } from './events/consumed-event.processor';
import { EventsModule } from './events/events.module';
import { EmployeeCreatedHandlers } from './invitations/employee-created.handlers';
import { InvitationAcceptService } from './invitations/invitation-accept.service';
import { InvitationsController } from './invitations/invitations.controller';
import { InvitationsService } from './invitations/invitations.service';
import { PasswordResetConfirmService } from './password-reset/password-reset-confirm.service';
import { PasswordResetCreateService } from './password-reset/password-reset-create.service';
import { PasswordResetController } from './password-reset/password-reset.controller';
import { PrismaService } from './prisma/prisma.service';
import { TenantPlanHandlers } from './tenants/tenant-plan.handlers';
import { TenantPurgeHandlers } from './tenants/tenant-purge.handlers';
import { TenantStatusBillingHandlers } from './tenants/tenant-status.billing.handlers';
import { TokenService } from './token.service';
import { UserAssignSitesService } from './users/user-assign-sites.service';
import { UserChangeRoleService } from './users/user-change-role.service';
import { UserDeactivateService } from './users/user-deactivate.service';
import { UserListRecipientsService } from './users/user-list-recipients.service';
import { UsersController } from './users/users.controller';

// Only the facade (AuthService) is exported; Prisma, tokens and the admin
// services stay private. UserListRecipientsService is internal (no route);
// the facade method for `notifications` is added when that module exists.
@Module({
  imports: [
    EventsModule,
    JwtModule.register({
      secret: envs.jwtSecret,
      signOptions: { algorithm: 'HS256' },
    }),
  ],
  controllers: [
    AuthController,
    AuthTokenResponder,
    InvitationsController,
    UsersController,
    PasswordResetController,
  ],
  providers: [
    PrismaService,
    AuthService,
    TokenService,
    InvitationsService,
    InvitationAcceptService,
    UserChangeRoleService,
    UserAssignSitesService,
    UserDeactivateService,
    UserListRecipientsService,
    PasswordResetCreateService,
    PasswordResetConfirmService,
    ConsumedEventProcessor,
    EmployeeCreatedHandlers,
    TenantStatusBillingHandlers,
    TenantPlanHandlers,
    TenantPurgeHandlers,
  ],
  exports: [AuthService],
})
export class AuthModule {}
