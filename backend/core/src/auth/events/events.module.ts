import { Module } from '@nestjs/common';
import { envs } from '../../config';
import { buildNatsOptions } from '../../config/nats-options';
import { JETSTREAM_OPTIONS, JetStreamService } from './jetstream.service';

// Private to `auth`. `ConsumedEventProcessor` and the event handlers live in
// `AuthModule` because they need its `PrismaService`; they register their
// handlers on `JetStreamService` in `onModuleInit`.
@Module({
  providers: [
    {
      provide: JETSTREAM_OPTIONS,
      useFactory: () => buildNatsOptions(envs.natsServers, envs.natsCreds),
    },
    JetStreamService,
  ],
  exports: [JetStreamService],
})
export class EventsModule {}
