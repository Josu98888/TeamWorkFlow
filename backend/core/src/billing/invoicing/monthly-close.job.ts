import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { envs } from '../../config';
import { InvoicingService } from './invoicing.service';

@Injectable()
export class MonthlyCloseJob {
  private readonly logger = new Logger(MonthlyCloseJob.name);

  constructor(private readonly invoicingService: InvoicingService) {}

  @Cron('0 3 1 * *', { timeZone: envs.billingTz })
  async handleMonthlyClose() {
    this.logger.log('Starting monthly invoicing close job');
    try {
      const invoices = await this.invoicingService.closeMonth();
      this.logger.log(`Monthly close completed. Issued ${invoices.length} invoices.`);
    } catch (error) {
      this.logger.error('Error during monthly close job', error);
    }
  }
}
