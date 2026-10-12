import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '../auth/auth.patterns';
import { CreateInvitationDto } from './dto/invitation-create.dto';
import { CreatedInvitation, InvitationsService } from './invitations.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @MessagePattern(AUTH_PATTERNS.invitationCreate)
  create(@Payload() dto: CreateInvitationDto): Promise<CreatedInvitation> {
    return this.invitations.create(dto);
  }
}
