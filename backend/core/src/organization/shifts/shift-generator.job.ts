import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ShiftTemplatesService,
  type ShiftGenerationSummary,
} from './shift-templates.service';

// Runs once daily to materialize upcoming `Shift` rows for every active
// `ShiftTemplate` within the next `SHIFT_HORIZON_DAYS` days.
@Injectable()
export class ShiftGeneratorJob {
  private readonly logger = new Logger(ShiftGeneratorJob.name);
  private running = false;

  constructor(private readonly templates: ShiftTemplatesService) {}

  @Cron('0 2 * * *')
  async handleDailyGeneration() {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick(new Date());
    } catch (error) {
      // Never log the error message: it may carry tenant identifiers.
      this.logger.error(
        `Shift template generation failed (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
    } finally {
      this.running = false;
    }
  }

  // Plain method so tests can drive it deterministically with a fixed `now`.
  tick(now: Date): Promise<ShiftGenerationSummary> {
    return this.templates.generateUpcomingForActiveTenants(now);
  }
}
