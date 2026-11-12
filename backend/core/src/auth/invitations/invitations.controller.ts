import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentActor } from '../../http/decorators/current-actor.decorator';
import { Public } from '../../http/decorators/public.decorator';
import { toServiceActor } from '../service-actor';
import type { TokenPair } from '../token.service';
import type { VerifiedActor } from '../verified-actor';
import { AcceptInvitationDto } from './dto/invitation-accept.dto';
import { CreateInvitationBodyDto } from './dto/invitation-create.dto';
import { InvitationIdParamDto } from './dto/invitation-id-param.dto';
import { InvitationAcceptService } from './invitation-accept.service';
import {
  CreatedInvitation,
  InvitationsService,
  PendingInvitation,
} from './invitations.service';

// HTTP transport only: the actor comes from the guard (never from the body)
// and the service applies the role and tenant rules.
@Controller('auth/invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly accepts: InvitationAcceptService,
  ) {}

  @Post()
  create(
    @CurrentActor() actor: VerifiedActor,
    @Body() body: CreateInvitationBodyDto,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(
      Object.assign({}, body, { actor: toServiceActor(actor) }),
    );
  }

  @Get()
  list(@CurrentActor() actor: VerifiedActor): Promise<PendingInvitation[]> {
    return this.invitations.list({ actor: toServiceActor(actor) });
  }

  // Public: the invitation token in the body is the credential. Declared
  // before the `:invitationId` routes; the paths differ in segment count.
  @Public()
  @Post('accept')
  accept(@Body() body: AcceptInvitationDto): Promise<TokenPair> {
    return this.accepts.accept(body);
  }

  @Post(':invitationId/regenerate')
  regenerate(
    @CurrentActor() actor: VerifiedActor,
    @Param() params: InvitationIdParamDto,
  ): Promise<CreatedInvitation> {
    return this.invitations.regenerate(
      Object.assign({}, params, { actor: toServiceActor(actor) }),
    );
  }
}
