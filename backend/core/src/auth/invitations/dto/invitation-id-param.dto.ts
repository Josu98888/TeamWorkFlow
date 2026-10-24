import { IsUUID } from 'class-validator';

// Path params of `POST /auth/invitations/:invitationId/regenerate`.
export class InvitationIdParamDto {
  @IsUUID()
  invitationId!: string;
}
