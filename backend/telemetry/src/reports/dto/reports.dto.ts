import { Type } from 'class-transformer';
import {
  IsBoolean,
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

  @IsBoolean()
  receiveDaily!: boolean;

  @IsBoolean()
  receiveMonthly!: boolean;

  @IsBoolean()
  receivePayrollExcel!: boolean;
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
