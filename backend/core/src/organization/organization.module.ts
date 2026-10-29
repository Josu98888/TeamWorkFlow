import { Module } from '@nestjs/common';
import { EmployeesController } from './employees/employees.controller';
import { EmployeesService } from './employees/employees.service';
import { UserCreatedHandler } from './employees/user-created.handler';
import { ConsumedEventProcessor } from './events/consumed-event.processor';
import { OrganizationEventsModule } from './events/organization-events.module';
import { OrganizationService } from './organization.service';
import { OrganizationPrismaService } from './prisma/prisma.service';
import { PostsService } from './sites/posts.service';
import { SitesController } from './sites/sites.controller';
import { SitesService } from './sites/sites.service';

// Only the facade (OrganizationService) is exported; Prisma, the events
// service and the sub-module services stay private. The shifts sub-module is
// added by its own task.
@Module({
  imports: [OrganizationEventsModule],
  controllers: [SitesController, EmployeesController],
  providers: [
    OrganizationPrismaService,
    SitesService,
    PostsService,
    EmployeesService,
    ConsumedEventProcessor,
    UserCreatedHandler,
    OrganizationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
