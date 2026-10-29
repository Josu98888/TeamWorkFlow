import { Global, Module } from '@nestjs/common';
import { NatsClientService } from './nats-client.service';
import { JetStreamService } from './jetstream.service';

@Global()
@Module({
  providers: [NatsClientService, JetStreamService],
  exports: [NatsClientService, JetStreamService],
})
export class NatsModule {}
