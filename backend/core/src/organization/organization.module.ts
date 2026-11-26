import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthService } from '../auth/auth.service';
import { EmployeesController } from './employees/employees.controller';
import {
  EMPLOYEE_AUTH_PROVISIONER,
  EmployeesService,
} from './employees/employees.service';
import { UserCreatedHandler } from './employees/user-created.handler';
import { ConsumedEventProcessor } from './events/consumed-event.processor';
import { OrganizationEventsModule } from './events/organization-events.module';
import { OrganizationService } from './organization.service';
import { OrganizationPrismaService } from './prisma/prisma.service';
import { OrganizationResponder } from './responders/organization.responder';
import { PostsService } from './sites/posts.service';
import { SitesController } from './sites/sites.controller';
import { SitesService } from './sites/sites.service';
import { ShiftGeneratorJob } from './shifts/shift-generator.job';
import { ShiftLifecycleService } from './shifts/shift-lifecycle.service';
import { ShiftTemplatesController } from './shifts/shift-templates.controller';
import { ShiftTemplatesService } from './shifts/shift-templates.service';
import { ShiftsController } from './shifts/shifts.controller';
import { ShiftsService } from './shifts/shifts.service';

// Only the facade (OrganizationService) is exported; Prisma, the events
// service and the sub-module services stay private.
@Module({
  imports: [OrganizationEventsModule, AuthModule],
  controllers: [
    SitesController,
    EmployeesController,
    ShiftsController,
    ShiftTemplatesController,
    OrganizationResponder,
  ],
  providers: [
    OrganizationPrismaService,
    SitesService,
    PostsService,
    EmployeesService,
    {
      provide: EMPLOYEE_AUTH_PROVISIONER,
      useExisting: AuthService,
    },
    ShiftsService,
    ShiftTemplatesService,
    ShiftLifecycleService,
    ShiftGeneratorJob,
    ConsumedEventProcessor,
    UserCreatedHandler,
    OrganizationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
