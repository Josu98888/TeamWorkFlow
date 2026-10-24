import { Injectable } from '@nestjs/common';
import { ForbiddenException } from '../../common/exceptions/app.exceptions';
import { toWireRole } from '../wire';
import { PrismaService } from '../prisma/prisma.service';
import { AssignUserSitesDto } from './dto/user-assign-sites.dto';
import { canAssignSites, isUserManager } from './user-policy';

@Injectable()
export class UserAssignSitesService {
  constructor(private readonly prisma: PrismaService) {}

  // Replaces the FULL site set of one supervisor (AGENTS Supervisor site
  // scope). Owner/admin only, same tenant, supervisor targets only: anything
  // else, including an unknown id, a user of another tenant and an inactive
  // user, answers the same `forbidden` (see S4.3, S5.2). Ids are deduplicated
  // here before saving; `auth` does not check that the sites exist. No event:
  // AGENTS defines none, and `auth.token.verify` reads `siteIds` from the user
  // row, so the new set applies to the next request.
  async assignSites(dto: AssignUserSitesDto): Promise<{ ok: true }> {
    const { actor } = dto;
    if (!isUserManager(actor) || actor.tenantId === null) {
      throw new ForbiddenException();
    }
    const tenantId = actor.tenantId;
    const siteIds = [...new Set(dto.siteIds)];

    const target = await this.prisma.user.findFirst({
      where: { id: dto.userId, tenantId, isActive: true },
      select: { id: true, tenantId: true, role: true },
    });
    if (
      !target ||
      !canAssignSites(actor, {
        userId: target.id,
        tenantId: target.tenantId,
        role: toWireRole(target.role),
      })
    ) {
      throw new ForbiddenException();
    }

    // Race-safe: only applies while the user is still an active supervisor of
    // the tenant, so a concurrent role change or deactivation cannot leave sites
    // on a non-supervisor.
    const updated = await this.prisma.user.updateMany({
      where: {
        id: target.id,
        tenantId,
        isActive: true,
        role: 'SUPERVISOR',
      },
      data: { siteIds },
    });
    if (updated.count !== 1) {
      throw new ForbiddenException();
    }
    return { ok: true };
  }
}
