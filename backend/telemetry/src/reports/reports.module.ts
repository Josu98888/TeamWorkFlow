import { Module } from '@nestjs/common';

import { SnapshotsModule } from '../snapshots/snapshots.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ExcelPayrollExporter } from './export/excel-payroll-exporter';
import { PdfReportExporter } from './export/pdf-report-exporter';
import { ReportRecipientsService } from './report-recipients.service';
import { ReportsController } from './reports.controller';
import { DailyReportJob, MonthlyReportJob } from './reports.jobs';
import { ReportsService } from './reports.service';

@Module({
  imports: [SnapshotsModule, TenantsModule],
  controllers: [ReportsController],
  providers: [
    ReportsService,
    ReportRecipientsService,
    PdfReportExporter,
    ExcelPayrollExporter,
    DailyReportJob,
    MonthlyReportJob,
  ],
  exports: [ReportsService, ReportRecipientsService],
})
export class ReportsModule {}
