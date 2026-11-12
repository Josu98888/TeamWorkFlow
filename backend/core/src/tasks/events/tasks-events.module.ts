import { Module } from '@nestjs/common';
import { envs } from '../../config';
import {
  TASKS_EVENTS_OPTIONS,
  TasksEventsService,
} from './tasks-events.service';

@Module({
  providers: [
    {
      provide: TASKS_EVENTS_OPTIONS,
      useFactory: () => ({ servers: envs.natsServers }),
    },
    TasksEventsService,
  ],
  exports: [TasksEventsService],
})
export class TasksEventsModule {}
