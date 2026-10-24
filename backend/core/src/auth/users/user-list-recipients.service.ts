import { Injectable } from '@nestjs/common';
import { fromWireRole } from '../wire';
import { PrismaService } from '../prisma/prisma.service';
import { ListRecipientsDto } from './dto/user-list-recipients.dto';

@Injectable()
export class UserListRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Internal operation (AGENTS NATS Contract): ACTIVE users of the tenant with
  // one of the requested roles. Without `siteId` that is all of them. With
  // `siteId`:
  //   - owner/admin are included whenever their role is requested: they see
  //     every site of the tenant (AGENTS Supervisor site scope);
  //   - supervisors only if `siteIds` has the site;
  //   - employees are NOT returned: `auth` does not store which site an
  //     employee works at (that is `organization` data, AGENTS Out of scope),
  //     so it cannot answer "employees of this site". The caller asks
  //     `organization` for them. Returning every employee of the tenant would
  //     notify people unrelated to the site.
  // The tenant filter uses the users (tenantId, role) index and `has` uses the
  // GIN index on `site_ids`. Ordered by id (uuid v7: creation order) so the
  // result is deterministic.
  async listRecipients(dto: ListRecipientsDto): Promise<{ userIds: string[] }> {
    const roles = dto.roles.map(fromWireRole);
    const { siteId } = dto;

    const users = await this.prisma.user.findMany({
      where: {
        tenantId: dto.tenantId,
        isActive: true,
        ...(siteId === undefined
          ? { role: { in: roles } }
          : {
              OR: [
                {
                  role: {
                    in: roles.filter((r) => r === 'OWNER' || r === 'ADMIN'),
                  },
                },
                ...(roles.includes('SUPERVISOR')
                  ? [{ role: 'SUPERVISOR' as const, siteIds: { has: siteId } }]
                  : []),
              ],
            }),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    return { userIds: users.map((user) => user.id) };
  }
}
