import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { envs } from '../../config';
import { PaymentsService } from './payments.service';

@Injectable()
export class ReconciliationJob {
  private readonly logger = new Logger(ReconciliationJob.name);

  constructor(private readonly paymentsService: PaymentsService) {}

  @Cron('0 6 * * *', { timeZone: envs.billingTz })
  async handleReconciliation() {
    this.logger.log('Starting daily payment reconciliation job');
    try {
      const count = await this.paymentsService.reconcileUnpaidInvoices();
      this.logger.log(`Payment reconciliation completed. Reconciled ${count} payments.`);
    } catch (error) {
      this.logger.error('Error during payment reconciliation job', error);
    }
  }
}
