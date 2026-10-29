import {
  IsInt,
  IsISO8601,
  IsOptional,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
} from 'class-validator';
import { PageQueryDto } from '../../sites/dto/site.dto';

// An instant must state its offset (`Z` or `+hh:mm`): a bare local time would
// be ambiguous. The service parses it into a Date.
const OFFSET = /(Z|[+-]\d{2}:?\d{2})$/;
const OFFSET_MESSAGE = 'must be an ISO-8601 instant with a UTC offset';

// HTTP body of `POST /shifts`. The tenant comes from the actor.
export class CreateShiftBodyDto {
  @IsUUID()
  siteId!: string;

  @IsUUID()
  postId!: string;

  @IsISO8601({ strict: true })
  @Matches(OFFSET, { message: `startsAt ${OFFSET_MESSAGE}` })
  startsAt!: string;

  @IsISO8601({ strict: true })
  @Matches(OFFSET, { message: `endsAt ${OFFSET_MESSAGE}` })
  endsAt!: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string | null;
}

// HTTP body of `PATCH /shifts/:shiftId`. `version` is the one the caller read.
// The employee changes through reassign; the site never changes.
export class UpdateShiftBodyDto {
  @IsInt()
  @Min(1)
  version!: number;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true })
  @Matches(OFFSET, { message: `startsAt ${OFFSET_MESSAGE}` })
  startsAt?: string;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsISO8601({ strict: true })
  @Matches(OFFSET, { message: `endsAt ${OFFSET_MESSAGE}` })
  endsAt?: string;

  @ValidateIf((_: unknown, value: unknown) => value !== undefined)
  @IsUUID()
  postId?: string;
}

// `employeeId: null` unassigns the shift; the field itself is required.
export class ReassignShiftBodyDto {
  @IsInt()
  @Min(1)
  version!: number;

  @ValidateIf((_: unknown, value: unknown) => value !== null)
  @IsUUID()
  employeeId!: string | null;
}

export class CancelShiftBodyDto {
  @IsInt()
  @Min(1)
  version!: number;
}

export class ShiftIdParamDto {
  @IsUUID()
  shiftId!: string;
}

// Query of `GET /shifts`. `day` (YYYY-MM-DD) is read in the timezone of the
// site, so it requires `siteId`.
export class ListShiftsQueryDto extends PageQueryDto {
  @IsOptional()
  @IsUUID()
  siteId?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'day must be YYYY-MM-DD' })
  day?: string;
}
