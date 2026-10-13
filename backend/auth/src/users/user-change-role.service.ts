import { Injectable } from '@nestjs/common';
import { ForbiddenException } from '../common/exceptions/app.exceptions';
import { fromWireRole, toWireRole } from '../common/wire';
import { AUTH_EVENTS } from '../events/auth.events';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeUserRoleDto } from './dto/user-change-role.dto';
import { canChangeRole, isUserManager } from './user-policy';

@Injectable()
export class UserChangeRoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: JetStreamService,
  ) {}

  // supervisor <-> employee (owner/admin) and any change to or from `admin`
  // (owner only), see `user-policy.ts`. The target is read with the actor's
  // tenant, so an unknown id, a user of another tenant and an inactive user all
  // answer the same `forbidden`: AGENTS has no not-found code and a distinct
  // answer would reveal that an id exists in another tenant. The same role is a
  // no-op (no write, no event). Any role change clears `siteIds` (only a
  // supervisor may have sites; the user never was one after the change).
  async changeRole(dto: ChangeUserRoleDto): Promise<{ ok: true }> {
    const { actor } = dto;
    if (!isUserManager(actor) || actor.tenantId === null) {
      throw new ForbiddenException();
    }
    const tenantId = actor.tenantId;
    const newRole = fromWireRole(dto.role);

    const changed = await this.prisma.$transaction(async (tx) => {
      const target = await tx.user.findFirst({
        where: { id: dto.userId, tenantId, isActive: true },
        select: { id: true, tenantId: true, role: true },
      });
      if (
        !target ||
        !canChangeRole(
          actor,
          {
            userId: target.id,
            tenantId: target.tenantId,
            role: toWireRole(target.role),
          },
          dto.role,
        )
      ) {
        throw new ForbiddenException();
      }
      if (target.role === newRole) return false;

      // Race-safe: only applies if the role is still the one that was
      // authorized, so a concurrent change cannot slip past the policy.
      const updated = await tx.user.updateMany({
        where: { id: target.id, tenantId, isActive: true, role: target.role },
        data: { role: newRole, siteIds: [] },
      });
      if (updated.count !== 1) {
        throw new ForbiddenException();
      }
      return true;
    });

    // After commit; publish never throws (failures are logged without payload).
    if (changed) {
      await this.events.publish(tenantId, AUTH_EVENTS.userRoleChanged, {
        userId: dto.userId,
        tenantId,
        role: dto.role,
        actorId: actor.userId,
      });
    }
    return { ok: true };
  }
}
