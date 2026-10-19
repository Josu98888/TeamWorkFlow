import { Injectable } from '@nestjs/common';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { toWireRole } from '../common/wire';
import { AUTH_EVENTS } from '../events/auth.events';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { DeactivateUserDto } from './dto/user-deactivate.dto';
import { canDeactivate, isUserManager } from './user-policy';

@Injectable()
export class UserDeactivateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: JetStreamService,
  ) {}

  // Owner/admin per the role table (`user-policy.ts`): never the owner, never
  // yourself, admins only by the owner. The target is read with the actor's
  // tenant, so an unknown id, a user of another tenant and an already inactive
  // user all answer the same `forbidden` (see S4.3, S5.2): a second
  // deactivation is refused, not a silent no-op, and emits no second event.
  // The user row is never deleted (AGENTS Deactivation). Setting `isActive` and
  // revoking every refresh token happen in one transaction; login, refresh and
  // `auth.token.verify` already reject inactive users, so the access token dies
  // immediately too.
  async deactivate(dto: DeactivateUserDto): Promise<{ ok: true }> {
    const { actor } = dto;
    if (!isUserManager(actor) || actor.tenantId === null) {
      throw new ForbiddenException();
    }
    const tenantId = actor.tenantId;

    await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: dto.userId, tenantId, isActive: true },
        select: { id: true, tenantId: true, role: true },
      });
      if (
        !target ||
        !canDeactivate(actor, {
          userId: target.id,
          tenantId: target.tenantId,
          role: toWireRole(target.role),
        })
      ) {
        throw new ForbiddenException();
      }

      // Race-safe: only applies if the user is still active with the role that
      // was authorized, so a concurrent role change or deactivation cannot slip
      // past the policy (and two concurrent calls emit one event).
      const updated = await tx.user.updateMany({
        where: { id: target.id, tenantId, isActive: true, role: target.role },
        data: { isActive: false },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException();
      }
      await tx.refreshToken.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    // After commit; publish never throws (failures are logged without payload).
    await this.events.publish(tenantId, AUTH_EVENTS.userDeactivated, {
      userId: dto.userId,
      tenantId,
      actorId: actor.userId,
    });
    return { ok: true };
  }
}
