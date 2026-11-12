import { Global, Module } from '@nestjs/common';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { envs } from '../config';
import { NATS_SERVICE } from './nats.constants';
import { NatsClientService } from './nats-client.service';
import { JetStreamService } from './jetstream.service';

@Global()
@Module({
  imports: [
    ClientsModule.register([
      {
        name: NATS_SERVICE,
        transport: Transport.NATS,
        options: { servers: envs.natsServers },
      },
    ]),
  ],
  providers: [NatsClientService, JetStreamService],
  exports: [NatsClientService, JetStreamService],
})
export class NatsModule {}
