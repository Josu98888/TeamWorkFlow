import { Module } from '@nestjs/common';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { UserCreatedHandler } from './employees/user-created.handler';
import { ConsumedEventProcessor } from './events/consumed-event.processor';
import { OrganizationEventsModule } from './events/organization-events.module';
import { OrganizationService } from './organization.service';
import { OrganizationPrismaService } from './prisma/prisma.service';
import { OrganizationResponder } from './responders/organization.responder';
import { PostsService } from './sites/posts.service';
import { SitesController } from './sites/sites.controller';
import { SitesService } from './sites/sites.service';
import { ShiftsController } from './shifts/shifts.controller';
import { ShiftsService } from './shifts/shifts.service';

// Only the facade (OrganizationService) is exported; Prisma, the events
// service and the sub-module services stay private.
@Module({
  imports: [OrganizationEventsModule],
  controllers: [
    SitesController,
    EmployeesController,
    ShiftsController,
    OrganizationResponder,
  ],
  providers: [
    OrganizationPrismaService,
    SitesService,
    PostsService,
    EmployeesService,
    ShiftsService,
    ConsumedEventProcessor,
    UserCreatedHandler,
    OrganizationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
