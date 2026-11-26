import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { RequireFeature } from '../http/decorators/features.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import type { VerifiedActor } from '../nats/dto/nats-contracts';
import {
  CloseMonthlyPayrollRunDto,
  DailyReportQueryDto,
  MonthlyEmployeeIdParamDto,
  MonthlyReportQueryDto,
  RecipientUserIdParamDto,
  ReportHistoryQueryDto,
  RequestSiteReportEmailDto,
  SiteIdParamDto,
  UpsertReportRecipientDto,
} from './dto/reports.dto';
import { ReportRecipientsService } from './report-recipients.service';
import { ReportsService } from './reports.service';
import { SiteReportEmailService } from './site-report-email.service';

@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly recipientsService: ReportRecipientsService,
    private readonly siteReportEmailService: SiteReportEmailService,
  ) {}

  @Get('sites/:siteId/email-status')
  getSiteEmailRequestStatus(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: SiteIdParamDto,
  ) {
    return this.siteReportEmailService.getSiteEmailRequestStatus(
      actor,
      params.siteId,
    );
  }

  @Post('sites/:siteId/request-email')
  @HttpCode(HttpStatus.CREATED)
  requestSiteReportEmail(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: SiteIdParamDto,
    @Body() dto: RequestSiteReportEmailDto,
  ) {
    return this.siteReportEmailService.requestSiteReportEmail(
      actor,
      params.siteId,
      dto,
    );
  }

  @Get('recipients')
  @Roles('owner')
  listRecipients(@CurrentActor() actor: VerifiedActor) {
    return this.recipientsService.listRecipients(actor);
  }

  @Put('recipients/:userId')
  @Roles('owner')
  upsertRecipient(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: RecipientUserIdParamDto,
    @Body() dto: UpsertReportRecipientDto,
  ) {
    return this.recipientsService.upsertRecipient(actor, params.userId, dto);
  }

  @Delete('recipients/:userId')
  @Roles('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRecipient(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: RecipientUserIdParamDto,
  ): Promise<void> {
    await this.recipientsService.removeRecipient(actor, params.userId);
  }

  @Get('daily')
  getDailyReport(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: DailyReportQueryDto,
  ) {
    return this.reportsService.getDailyReport(actor, query);
  }

  @Get('daily/pdf')
  async exportDailyPdf(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: DailyReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.reportsService.exportDailyPdf(
      actor,
      query,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  @Get('daily/history')
  listDailyHistory(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.listDailyHistory(actor, query);
  }

  @Get('monthly')
  getMonthlyReport(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: MonthlyReportQueryDto,
  ) {
    return this.reportsService.getMonthlyReport(actor, query);
  }

  @Get('monthly/pdf')
  async exportMonthlyPdf(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: MonthlyReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } = await this.reportsService.exportMonthlyPdf(
      actor,
      query,
    );
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  @Get('monthly/history')
  listMonthlyHistory(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.listMonthlyHistory(actor, query);
  }

  @Get('monthly/payroll')
  @RequireFeature('payroll_reports')
  getMonthlyPayroll(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: MonthlyReportQueryDto,
  ) {
    return this.reportsService.getMonthlyPayrollPreview(actor, query);
  }

  @Get('monthly/export')
  @RequireFeature('payroll_reports')
  async exportMonthlyPayrollExcel(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: MonthlyReportQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { buffer, filename } =
      await this.reportsService.exportMonthlyPayrollExcel(actor, query);
    res.set({
      'Content-Type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  @Post('monthly/payroll-runs')
  @RequireFeature('payroll_reports')
  closeMonthlyPayrollRun(
    @CurrentActor() actor: VerifiedActor,
    @Body() dto: CloseMonthlyPayrollRunDto,
  ) {
    return this.reportsService.closeMonthlyPayrollRun(actor, dto);
  }

  @Get('monthly/payroll-runs')
  @RequireFeature('payroll_reports')
  listPayrollRuns(
    @CurrentActor() actor: VerifiedActor,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.listPayrollRuns(actor, query);
  }

  @Get('monthly/:employeeId')
  getEmployeeMonthlyDetail(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: MonthlyEmployeeIdParamDto,
    @Query() query: MonthlyReportQueryDto,
  ) {
    return this.reportsService.getEmployeeMonthlyDetail(
      actor,
      params.employeeId,
      query,
    );
  }
}
