import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { buildNatsOptions } from '../../config/nats-options';
import {
  TASKS_EVENTS_OPTIONS,
  TasksEventsService,
} from './tasks-events.service';

@Module({
  providers: [
    {
      provide: TASKS_EVENTS_OPTIONS,
      useFactory: () => buildNatsOptions(envs.natsServers, envs.natsCreds),
    },
    TasksEventsService,
  ],
  exports: [TasksEventsService],
})
export class TasksEventsModule {}
