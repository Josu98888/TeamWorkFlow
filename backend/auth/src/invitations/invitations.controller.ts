import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AUTH_PATTERNS } from '../auth/auth.patterns';
import type { TokenPair } from '../auth/token.service';
import { AcceptInvitationDto } from './dto/invitation-accept.dto';
import { CreateInvitationDto } from './dto/invitation-create.dto';
import { ListInvitationsDto } from './dto/invitation-list.dto';
import { RegenerateInvitationDto } from './dto/invitation-regenerate.dto';
import { InvitationAcceptService } from './invitation-accept.service';
import {
  CreatedInvitation,
  InvitationsService,
  PendingInvitation,
} from './invitations.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly accepts: InvitationAcceptService,
  ) {}

  @MessagePattern(AUTH_PATTERNS.invitationCreate)
  create(@Payload() dto: CreateInvitationDto): Promise<CreatedInvitation> {
    return this.invitations.create(dto);
  }

  @MessagePattern(AUTH_PATTERNS.invitationList)
  list(@Payload() dto: ListInvitationsDto): Promise<PendingInvitation[]> {
    return this.invitations.list(dto);
  }

  @MessagePattern(AUTH_PATTERNS.invitationRegenerate)
  regenerate(
    @Payload() dto: RegenerateInvitationDto,
  ): Promise<CreatedInvitation> {
    return this.invitations.regenerate(dto);
  }

  // Public pattern: no actor, the invitation token is the credential.
  @MessagePattern(AUTH_PATTERNS.invitationAccept)
  accept(@Payload() dto: AcceptInvitationDto): Promise<TokenPair> {
    return this.accepts.accept(dto);
  }
}
