import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from 'class-validator';

// Roles a notification can target: every tenant role, never platform_admin
// (it belongs to no tenant, so it can never be a recipient of one).
export const RECIPIENT_ROLES = [
  'owner',
  'admin',
  'supervisor',
  'employee',
] as const;

export type RecipientRole = (typeof RECIPIENT_ROLES)[number];

// Payload of `auth.user.list-recipients`. Internal services only (never the
// gateway), so there is no actor: the calling service names the tenant. Not a
// client-supplied tenant: the pattern is not reachable from the outside.
export class ListRecipientsDto {
  @IsUUID()
  tenantId!: string;

  // At least one role, at most one of each (the bound is the enum size).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(RECIPIENT_ROLES.length)
  @ArrayUnique()
  @IsIn(RECIPIENT_ROLES, { each: true })
  roles!: RecipientRole[];

  @IsOptional()
  @IsUUID()
  siteId?: string;
}
