import { Module } from '@nestjs/common';
import { OrganizationEventsModule } from './events/organization-events.module';
import { OrganizationService } from './organization.service';
import { OrganizationPrismaService } from './prisma/prisma.service';
import { PostsService } from './sites/posts.service';
import { SitesController } from './sites/sites.controller';
import { SitesService } from './sites/sites.service';

// Only the facade (OrganizationService) is exported; Prisma, the events
// service and the sub-module services stay private. The employees and shifts
// sub-modules are added by their own tasks.
@Module({
  imports: [OrganizationEventsModule],
  controllers: [SitesController],
  providers: [
    OrganizationPrismaService,
    SitesService,
    PostsService,
    OrganizationService,
  ],
  exports: [OrganizationService],
})
export class OrganizationModule {}
