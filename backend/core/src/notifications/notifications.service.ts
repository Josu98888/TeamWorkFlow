import { Injectable } from '@nestjs/common';
import {
  InAppNotificationsService,
  type ListNotificationsInput,
  type ListNotificationsResult,
  type MarkReadInput,
  type MarkReadResult,
} from './in-app/in-app-notifications.service';
import {
  PushTokensService,
  type NotificationActor,
  type RegisterPushTokenInput,
  type RegisteredDeviceSummary,
  type UnregisterPushTokenInput,
} from './push-tokens/push-tokens.service';

// Public facade of the notifications module (AGENTS § Module Boundaries).
// Each method mirrors its stable `notifications.<resource>.<action>` contract.
@Injectable()
export class NotificationsService {
  constructor(
    private readonly pushTokens: PushTokensService,
    private readonly inApp: InAppNotificationsService,
  ) {}

  // notifications.push-token.register
  pushTokenRegister(
    actor: NotificationActor,
    input: RegisterPushTokenInput,
  ): Promise<RegisteredDeviceSummary> {
    return this.pushTokens.register(actor, input);
  }

  // notifications.push-token.unregister
  pushTokenUnregister(
    actor: NotificationActor,
    input: UnregisterPushTokenInput,
  ): Promise<{ unregistered: boolean }> {
    return this.pushTokens.unregister(actor, input);
  }

  // notifications.notification.list
  notificationList(
    actor: NotificationActor,
    query: ListNotificationsInput = {},
  ): Promise<ListNotificationsResult> {
    return this.inApp.list(actor, query);
  }

  // notifications.notification.unread-count
  notificationUnreadCount(
    actor: NotificationActor,
  ): Promise<{ count: number }> {
    return this.inApp.unreadCount(actor);
  }

  // notifications.notification.mark-read
  notificationMarkRead(
    actor: NotificationActor,
    input: MarkReadInput,
  ): Promise<MarkReadResult> {
    return this.inApp.markRead(actor, input);
  }
}
