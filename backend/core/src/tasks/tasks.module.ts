import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module';
import { TasksEventsModule } from './events/tasks-events.module';
import { ConsumedEventsProcessor } from './events/consumed-events.processor';
import { FormsService } from './forms/forms.service';
import { FormsController } from './http/forms.controller';
import { MediaController } from './http/media.controller';
import { TaskTemplatesController } from './http/task-templates.controller';
import { TasksController } from './http/tasks.controller';
import { TaskExpirationJob } from './jobs/task-expiration.job';
import { MediaService } from './media/media.service';
import { StorageService } from './media/storage.service';
import { TasksPrismaService } from './prisma/prisma.service';
import { TaskManagementService } from './task-management/task-management.service';
import { TaskTemplatesService } from './templates/task-templates.service';
import { TasksService } from './tasks.service';

@Module({
  imports: [TasksEventsModule, OrganizationModule],
  controllers: [
    FormsController,
    TaskTemplatesController,
    TasksController,
    MediaController,
  ],
  providers: [
    TasksPrismaService,
    StorageService,
    FormsService,
    TaskTemplatesService,
    MediaService,
    TaskManagementService,
    TasksService,
    ConsumedEventsProcessor,
    TaskExpirationJob,
  ],
  exports: [TasksService],
})
export class TasksModule {}
