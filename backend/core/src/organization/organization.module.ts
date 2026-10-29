import { Module } from '@nestjs/common';
import { OrganizationEventsModule } from './events/organization-events.module';
import { OrganizationService } from './organization.service';
import { OrganizationPrismaService } from './prisma/prisma.service';

// Only the facade (OrganizationService) is exported; Prisma and the events
// service stay private. The sites, employees and shifts sub-modules are added
// by their own tasks.
@Module({
  imports: [OrganizationEventsModule],
  providers: [OrganizationPrismaService, OrganizationService],
  exports: [OrganizationService],
})
export class OrganizationModule {}
