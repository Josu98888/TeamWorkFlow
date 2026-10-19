import { Injectable } from '@nestjs/common';
import { hashPassword, hashToken } from '../common/crypto';
import { InvalidTokenException } from '../common/exceptions/app.exceptions';
import { PrismaService } from '../prisma/prisma.service';
import { ConfirmPasswordResetDto } from './dto/password-reset-confirm.dto';

@Injectable()
export class PasswordResetConfirmService {
  constructor(private readonly prisma: PrismaService) {}

  // Public: the single-use token is the credential. Unknown, used, expired
  // tokens and tokens of a deactivated user (or purged tenant) are the same
  // generic `invalid_token` (AGENTS Password reset, Errors).
  // The token is consumed, the password replaced and every refresh token of
  // the user revoked in ONE transaction. The lockout counters are cleared too:
  // an admin-verified reset is the recovery path for a locked-out user, so it
  // must not leave them waiting out the 15-minute lock (AGENTS Brute-force
  // protection). Any other unused reset token of the user dies with this one.
  // No event: AGENTS defines none for password resets.
  async confirm(dto: ConfirmPasswordResetDto): Promise<{ ok: true }> {
    const now = new Date();
    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      select: {
        id: true,
        userId: true,
        usedAt: true,
        expiresAt: true,
        user: {
          select: { isActive: true, tenant: { select: { status: true } } },
        },
      },
    });
    if (
      !stored ||
      stored.usedAt !== null ||
      stored.expiresAt.getTime() <= now.getTime() ||
      !stored.user.isActive ||
      stored.user.tenant?.status === 'DELETED'
    ) {
      throw new InvalidTokenException();
    }

    // Hashed before the transaction: it is CPU-bound and must not hold a connection.
    const passwordHash = await hashPassword(dto.password);

    await this.prisma.$transaction(async (tx) => {
      // Race-safe: of two concurrent confirms only one flips the row, and a
      // token that expired meanwhile is refused.
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: stored.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) {
        throw new InvalidTokenException();
      }

      // Still active at write time (a deactivation racing with the confirm
      // must not get a new password back into an inactive account).
      const updated = await tx.user.updateMany({
        where: { id: stored.userId, isActive: true },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      });
      if (updated.count !== 1) {
        throw new InvalidTokenException();
      }

      await tx.passwordResetToken.updateMany({
        where: { userId: stored.userId, usedAt: null },
        data: { usedAt: now },
      });
      await tx.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: now },
      });
    });

    return { ok: true };
  }
}
