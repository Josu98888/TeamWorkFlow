import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { envs } from '../config';
import { OrganizationModule } from '../organization/organization.module';
import { DeliveryService } from './delivery/delivery.service';
import { NotificationsEventsModule } from './events/notifications-events.module';
import { NotificationsController } from './http/notifications.controller';
import { PushTokensController } from './http/push-tokens.controller';
import { InAppNotificationsService } from './in-app/in-app-notifications.service';
import { DeliveryRetryJob } from './jobs/delivery-retry.job';
import { NotificationsService } from './notifications.service';
import { NotificationsPrismaModule } from './prisma/prisma.module';
import { FakeFcmProviderService } from './providers/fake-fcm-provider.service';
import { FCM_PROVIDER } from './providers/fcm-provider.interface';
import { FirebaseAdminProviderService } from './providers/firebase-admin-provider.service';
import { PushTokensService } from './push-tokens/push-tokens.service';
import { ConsumedEventsProcessor } from './routing/consumed-events.processor';

@Module({
  imports: [
    NotificationsPrismaModule,
    NotificationsEventsModule,
    AuthModule,
    OrganizationModule,
  ],
  controllers: [PushTokensController, NotificationsController],
  providers: [
    FakeFcmProviderService,
    FirebaseAdminProviderService,
    {
      provide: FCM_PROVIDER,
      inject: [FakeFcmProviderService, FirebaseAdminProviderService],
      useFactory: (
        fake: FakeFcmProviderService,
        firebase: FirebaseAdminProviderService,
      ) => (envs.fcmEnabled ? firebase : fake),
    },
    PushTokensService,
    InAppNotificationsService,
    DeliveryService,
    DeliveryRetryJob,
    ConsumedEventsProcessor,
    NotificationsService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
