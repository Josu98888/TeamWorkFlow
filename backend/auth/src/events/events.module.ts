import { Module } from '@nestjs/common';
import { envs } from '../config';
import { ConsumedEventProcessor } from './consumed-event.processor';
import { JETSTREAM_OPTIONS, JetStreamService } from './jetstream.service';

@Module({
  providers: [
    {
      provide: JETSTREAM_OPTIONS,
      useFactory: () => ({ servers: envs.natsServers }),
    },
    JetStreamService,
    ConsumedEventProcessor,
  ],
  exports: [JetStreamService, ConsumedEventProcessor],
})
export class EventsModule {}
