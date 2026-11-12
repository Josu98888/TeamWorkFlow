import { Module } from '@nestjs/common';
import { envs } from '../../config';
import {
  BILLING_EVENTS_OPTIONS,
  BillingEventsService,
} from './billing-events.service';

@Module({
  providers: [
    {
      provide: BILLING_EVENTS_OPTIONS,
      useFactory: () => ({ servers: envs.natsServers }),
    },
    BillingEventsService,
  ],
  exports: [BillingEventsService],
})
export class BillingEventsModule {}
