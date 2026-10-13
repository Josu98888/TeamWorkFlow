import { Injectable } from '@nestjs/common';
import type { WireInvitationRole } from '../common/wire';
import { generateOpaqueToken, hashToken } from '../common/crypto';
import { normalizeEmail } from '../common/email';
import {
  EmailTakenException,
  ForbiddenException,
} from '../common/exceptions/app.exceptions';
import { fromWireInvitationRole, toWireInvitationRole } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvitationDto } from './dto/invitation-create.dto';
import { ListInvitationsDto } from './dto/invitation-list.dto';
import { canInvite, canListInvitations } from './invitation-policy';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedInvitation {
  invitationId: string;
  // Raw single-use token: returned once, only its hash is stored.
  token: string;
  // ISO-8601 UTC (JSON over NATS has no Date type).
  expiresAt: string;
}

export interface PendingInvitation {
  invitationId: string;
  email: string;
  role: WireInvitationRole;
  // ISO-8601 UTC.
  expiresAt: string;
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateInvitationDto): Promise<CreatedInvitation> {
    const { actor } = dto;
    if (!canInvite(actor, dto.role) || actor.tenantId === null) {
      throw new ForbiddenException();
    }
    const tenantId = actor.tenantId;
    const email = normalizeEmail(dto.email);
    const token = generateOpaqueToken();
    const now = new Date();

    const invitation = await this.prisma.$transaction(async (tx) => {
      // Email is unique across the whole system, so any tenant counts.
      const existing = await tx.user.findUnique({
        where: { email },
        select: { id: true },
      });
      if (existing) {
        throw new EmailTakenException();
      }

      // One pending invitation per (tenant, email): revoke the previous one.
      await tx.invitation.updateMany({
        where: { tenantId, email, usedAt: null, revokedAt: null },
        data: { revokedAt: now },
      });

      return tx.invitation.create({
        data: {
          tenantId,
          email,
          role: fromWireInvitationRole(dto.role),
          tokenHash: hashToken(token),
          invitedById: actor.userId,
          expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        },
        select: { id: true, expiresAt: true },
      });
    });

    return {
      invitationId: invitation.id,
      token,
      expiresAt: invitation.expiresAt.toISOString(),
    };
  }

  // Pending = not used, not revoked and not expired. Metadata only: the token
  // exists solely as a hash, so links cannot be listed (AGENTS Invitations).
  async list(dto: ListInvitationsDto): Promise<PendingInvitation[]> {
    const { actor } = dto;
    if (!canListInvitations(actor) || actor.tenantId === null) {
      throw new ForbiddenException();
    }

    const invitations = await this.prisma.invitation.findMany({
      where: {
        tenantId: actor.tenantId,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      select: { id: true, email: true, role: true, expiresAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return invitations.map((invitation) => ({
      invitationId: invitation.id,
      email: invitation.email,
      role: toWireInvitationRole(invitation.role),
      expiresAt: invitation.expiresAt.toISOString(),
    }));
  }
}
