import { Controller, UseFilters, UsePipes } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { NatsErrorFilter } from '../../common/filters/nats-exception.filter';
import { createValidationPipe } from '../../common/pipes/validation.pipe';
import { ORGANIZATION_PATTERNS } from '../organization.patterns';
import { OrganizationService } from '../organization.service';
import {
  EmployeeGetRequestDto,
  ShiftGetRequestDto,
  SiteGetRequestDto,
} from './responder.dto';
import {
  toTelemetryEmployee,
  toTelemetryShift,
  toTelemetrySite,
  type TelemetryEmployeeDto,
  type TelemetryShiftDto,
  type TelemetrySiteDto,
} from './telemetry-wire';

// NATS request-reply responders for `telemetry`. Thin: validate, call the
// facade with the explicit tenant, map to the telemetry wire shape. The global
// HTTP pipe and filter do not apply to the microservice, so both are bound here.
// Errors leave as `{ status, code, message }`; nothing is logged here (no PII).
@Controller()
@UseFilters(NatsErrorFilter)
@UsePipes(createValidationPipe())
export class OrganizationResponder {
  constructor(private readonly organization: OrganizationService) {}

  @MessagePattern(ORGANIZATION_PATTERNS.siteGet)
  async getSite(@Payload() dto: SiteGetRequestDto): Promise<TelemetrySiteDto> {
    return toTelemetrySite(
      await this.organization.getSiteForTenant(dto.tenantId, dto.siteId),
    );
  }

  @MessagePattern(ORGANIZATION_PATTERNS.employeeGet)
  async getEmployee(
    @Payload() dto: EmployeeGetRequestDto,
  ): Promise<TelemetryEmployeeDto> {
    return toTelemetryEmployee(
      await this.organization.getEmployeeForTenant(dto.tenantId, {
        userId: dto.userId,
      }),
      dto.userId,
    );
  }

  @MessagePattern(ORGANIZATION_PATTERNS.shiftGet)
  async getShift(
    @Payload() dto: ShiftGetRequestDto,
  ): Promise<TelemetryShiftDto> {
    return toTelemetryShift(
      await this.organization.getShiftForTenant(dto.tenantId, dto.shiftId),
    );
  }
}
