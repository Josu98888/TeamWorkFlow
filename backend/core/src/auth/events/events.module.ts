import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { JETSTREAM_OPTIONS, JetStreamService } from './jetstream.service';

// Private to `auth`. `ConsumedEventProcessor` and the event handlers live in
// `AuthModule` because they need its `PrismaService`; they register their
// handlers on `JetStreamService` in `onModuleInit`.
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
