import { Injectable } from '@nestjs/common';
import { generateOpaqueToken, hashToken } from '../common/crypto';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { toWireRole } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { canCreatePasswordReset, isUserManager } from '../users/user-policy';
import { CreatePasswordResetDto } from './dto/password-reset-create.dto';

const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface CreatedPasswordReset {
  // Raw single-use token: returned once, only its hash is stored.
  token: string;
  // ISO-8601 UTC (JSON over NATS has no Date type).
  expiresAt: string;
}

@Injectable()
export class PasswordResetCreateService {
  constructor(private readonly prisma: PrismaService) {}

  // Owner/admin per the role table (`user-policy.ts`): admin links only by the
  // owner, never for the owner, a platform_admin or yourself. Same gate as
  // deactivating (S5.4): owner/admin with a tenant else `forbidden` before any
  // query; the target is read with the actor's tenant, so an unknown id, a user
  // of another tenant and an inactive user all answer the same `forbidden`.
  // One live link per user: creating a new one marks every previous unused
  // token of that user as used in the same transaction, so a lost or
  // superseded link cannot be redeemed afterwards (same idea as invitations).
  async create(dto: CreatePasswordResetDto): Promise<CreatedPasswordReset> {
    const { actor } = dto;
    if (!isUserManager(actor) || actor.tenantId === null) {
      throw new ForbiddenException();
    }
    const tenantId = actor.tenantId;
    const token = generateOpaqueToken();
    const now = new Date();

    const reset = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: dto.userId, tenantId, isActive: true },
        select: { id: true, tenantId: true, role: true },
      });
      if (
        !target ||
        !canCreatePasswordReset(actor, {
          userId: target.id,
          tenantId: target.tenantId,
          role: toWireRole(target.role),
        })
      ) {
        throw new ForbiddenException();
      }

      await tx.passwordResetToken.updateMany({
        where: { userId: target.id, usedAt: null },
        data: { usedAt: now },
      });

      return tx.passwordResetToken.create({
        data: {
          userId: target.id,
          tokenHash: hashToken(token),
          createdById: actor.userId,
          expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        },
        select: { expiresAt: true },
      });
    });

    return { token, expiresAt: reset.expiresAt.toISOString() };
  }
}
