import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class TrialExpirationJob {
  private readonly logger = new Logger(TrialExpirationJob.name);

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async handleTrialExpiration() {
    this.logger.debug('Running trial expiration job');
    try {
      const count = await this.subscriptionsService.expireTrials();
      if (count > 0) {
        this.logger.log(`Expired and transitioned ${count} trial subscriptions to ACTIVE`);
      }
    } catch (error) {
      this.logger.error('Error during trial expiration job', error);
    }
  }
}
