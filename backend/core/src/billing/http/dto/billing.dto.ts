import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class ChangePlanDto {
  @IsString()
  @IsIn(['basic', 'pro', 'BASIC', 'PRO'])
  plan!: string;
}

export class ResubscribeDto {
  @IsString()
  @IsIn(['basic', 'pro', 'BASIC', 'PRO'])
  plan!: string;
}

export class InvoiceIdParamDto {
  @IsUUID('7')
  invoiceId!: string;
}

export class TenantIdParamDto {
  @IsUUID('7')
  tenantId!: string;
}

export class PlanParamDto {
  @IsString()
  @IsIn(['basic', 'pro', 'BASIC', 'PRO'])
  plan!: string;
}

export class InvoiceListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  status?: any;

  @IsOptional()
  @IsString()
  period?: string;
}

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number = 20;
}

export class AdminUpdatePlanDto {
  @IsOptional()
  monthlyPrice?: string | number;

  @IsOptional()
  @IsObject()
  features?: Record<string, boolean>;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AdminExtendTrialDto {
  @IsDateString()
  trialEndsAt!: string;
}

export class AdminVoidInvoiceDto {
  @IsString()
  @IsNotEmpty()
  reason!: string;
}

export class AdminIssueInvoiceDto {
  @IsUUID('7')
  tenantId!: string;

  @IsString()
  @IsNotEmpty()
  period!: string;
}

export class AdminSetFiscalReceiptDto {
  @IsString()
  @IsNotEmpty()
  receiptNumber!: string;
}

export class AdminRegisterPaymentDto {
  @IsUUID('7')
  invoiceId!: string;

  @IsNotEmpty()
  amount!: string | number;

  @IsDateString()
  paidAt!: string;

  @IsString()
  @IsNotEmpty()
  reference!: string;
}
