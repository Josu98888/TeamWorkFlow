import { Injectable } from '@nestjs/common';
import { generateOpaqueToken, hashToken } from '../common/crypto';
import { normalizeEmail } from '../common/email';
import {
  EmailTakenException,
  ForbiddenException,
} from '../common/exceptions/app.exceptions';
import { fromWireInvitationRole } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvitationDto } from './dto/invitation-create.dto';
import { canInvite } from './invitation-policy';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CreatedInvitation {
  invitationId: string;
  // Raw single-use token: returned once, only its hash is stored.
  token: string;
  // ISO-8601 UTC (JSON over NATS has no Date type).
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
}
