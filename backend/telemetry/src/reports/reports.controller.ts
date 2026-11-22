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
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser } from '../http/decorators/current-user.decorator';
import { RequireFeature } from '../http/decorators/require-feature.decorator';
import { Roles } from '../http/decorators/roles.decorator';
import { AuthGuard } from '../http/guards/auth.guard';
import { FeatureFlagGuard } from '../http/guards/feature-flag.guard';
import { RolesGuard } from '../http/guards/roles.guard';
import { TenantActiveGuard } from '../http/guards/tenant-active.guard';
import type { AuthUser } from '../http/interfaces/auth-user.interface';
import {
  CloseMonthlyPayrollRunDto,
  DailyReportQueryDto,
  MonthlyEmployeeIdParamDto,
  MonthlyReportQueryDto,
  RecipientUserIdParamDto,
  ReportHistoryQueryDto,
  UpsertReportRecipientDto,
} from './dto/reports.dto';
import { ReportRecipientsService } from './report-recipients.service';
import { ReportsService } from './reports.service';

@Controller('reports')
@UseGuards(AuthGuard, TenantActiveGuard, RolesGuard, FeatureFlagGuard)
export class ReportsController {
  constructor(
    private readonly reportsService: ReportsService,
    private readonly recipientsService: ReportRecipientsService,
  ) {}

  @Get('recipients')
  @Roles('owner')
  listRecipients(@CurrentUser() actor: AuthUser) {
    return this.recipientsService.listRecipients(actor);
  }

  @Put('recipients/:userId')
  @Roles('owner')
  upsertRecipient(
    @CurrentUser() actor: AuthUser,
    @Param() params: RecipientUserIdParamDto,
    @Body() dto: UpsertReportRecipientDto,
  ) {
    return this.recipientsService.upsertRecipient(actor, params.userId, dto);
  }

  @Delete('recipients/:userId')
  @Roles('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRecipient(
    @CurrentUser() actor: AuthUser,
    @Param() params: RecipientUserIdParamDto,
  ): Promise<void> {
    await this.recipientsService.removeRecipient(actor, params.userId);
  }

  @Get('daily')
  getDailyReport(
    @CurrentUser() actor: AuthUser,
    @Query() query: DailyReportQueryDto,
  ) {
    return this.reportsService.getDailyReport(actor, query);
  }

  @Get('daily/pdf')
  async exportDailyPdf(
    @CurrentUser() actor: AuthUser,
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
    @CurrentUser() actor: AuthUser,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.listDailyHistory(actor, query);
  }

  @Get('monthly')
  getMonthlyReport(
    @CurrentUser() actor: AuthUser,
    @Query() query: MonthlyReportQueryDto,
  ) {
    return this.reportsService.getMonthlyReport(actor, query);
  }

  @Get('monthly/pdf')
  async exportMonthlyPdf(
    @CurrentUser() actor: AuthUser,
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
    @CurrentUser() actor: AuthUser,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.listMonthlyHistory(actor, query);
  }

  @Get('monthly/payroll')
  @RequireFeature('payroll_reports')
  getMonthlyPayroll(
    @CurrentUser() actor: AuthUser,
    @Query() query: MonthlyReportQueryDto,
  ) {
    return this.reportsService.getMonthlyPayrollPreview(actor, query);
  }

  @Get('monthly/export')
  @RequireFeature('payroll_reports')
  async exportMonthlyPayrollExcel(
    @CurrentUser() actor: AuthUser,
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
    @CurrentUser() actor: AuthUser,
    @Body() dto: CloseMonthlyPayrollRunDto,
  ) {
    return this.reportsService.closeMonthlyPayrollRun(actor, dto);
  }

  @Get('monthly/payroll-runs')
  @RequireFeature('payroll_reports')
  listPayrollRuns(
    @CurrentUser() actor: AuthUser,
    @Query() query: ReportHistoryQueryDto,
  ) {
    return this.reportsService.listPayrollRuns(actor, query);
  }

  @Get('monthly/:employeeId')
  getEmployeeMonthlyDetail(
    @CurrentUser() actor: AuthUser,
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
