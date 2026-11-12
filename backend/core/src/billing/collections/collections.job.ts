import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { envs } from '../../config';
import { CollectionsService } from './collections.service';

@Injectable()
export class CollectionsJob {
  private readonly logger = new Logger(CollectionsJob.name);

  constructor(private readonly collectionsService: CollectionsService) {}

  @Cron('0 9 * * *', { timeZone: envs.billingTz })
  async handleCollectionsAndRetention() {
    this.logger.log('Starting daily collections and data retention job');
    try {
      await this.collectionsService.processCollections();
      await this.collectionsService.processDataRetention();
      this.logger.log('Collections and data retention job completed successfully');
    } catch (error) {
      this.logger.error('Error during collections job execution', error);
    }
  }
}
