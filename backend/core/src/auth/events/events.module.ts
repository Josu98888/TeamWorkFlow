import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { JETSTREAM_OPTIONS, JetStreamService } from './jetstream.service';

// Private to `auth`. The consumed-event processor joins it in T6.5.
@Module({
  providers: [
    {
      provide: JETSTREAM_OPTIONS,
      useFactory: () => ({ servers: envs.natsServers }),
    },
    JetStreamService,
  ],
  exports: [JetStreamService],
})
export class EventsModule {}
