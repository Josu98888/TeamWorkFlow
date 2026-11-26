import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class DailyReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be formatted as YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;
}

export class MonthlyReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period must be formatted as YYYY-MM',
  })
  period?: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;
}

export class ReportHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class UpsertReportRecipientDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  siteIds?: string[];

  @IsBoolean()
  receiveDaily!: boolean;

  @IsBoolean()
  receiveMonthly!: boolean;

  @IsBoolean()
  receivePayrollExcel!: boolean;
}

export const SITE_REPORT_EMAIL_KINDS = [
  'daily_absences_pdf',
  'monthly_attendance_pdf',
  'monthly_payroll_excel',
] as const;

export type SiteReportEmailKindDto = (typeof SITE_REPORT_EMAIL_KINDS)[number];

export class SiteIdParamDto {
  @IsUUID()
  siteId!: string;
}

export class RequestSiteReportEmailDto {
  @IsIn(SITE_REPORT_EMAIL_KINDS)
  kind!: SiteReportEmailKindDto;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be formatted as YYYY-MM-DD',
  })
  date?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period must be formatted as YYYY-MM',
  })
  period?: string;
}

export class RecipientUserIdParamDto {
  @IsUUID()
  userId!: string;
}

export class MonthlyEmployeeIdParamDto {
  @IsUUID()
  employeeId!: string;
}

export class PayrollRunIdParamDto {
  @IsUUID()
  runId!: string;
}

export class CloseMonthlyPayrollRunDto {
  @Matches(/^\d{4}-\d{2}$/, {
    message: 'period must be formatted as YYYY-MM',
  })
  period!: string;

  @IsOptional()
  @IsUUID()
  siteId?: string;
}
