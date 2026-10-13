import { Injectable } from '@nestjs/common';
import { TokenPair, TokenService } from '../auth/token.service';
import { hashPassword, hashToken } from '../common/crypto';
import {
  EmailTakenException,
  InvalidTokenException,
} from '../common/exceptions/app.exceptions';
import { assertTenantAllowsAccess } from '../common/tenant-access';
import { fromWireRole, toWireInvitationRole, toWireRole } from '../common/wire';
import { AUTH_EVENTS } from '../events/auth.events';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { AcceptInvitationDto } from './dto/invitation-accept.dto';

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class InvitationAcceptService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly events: JetStreamService,
  ) {}

  // Public: the single-use token is the credential. Unknown, used, revoked and
  // expired tokens are the same generic `invalid_token` (AGENTS Invitations).
  async accept(dto: AcceptInvitationDto): Promise<TokenPair> {
    const now = new Date();
    const invitation = await this.prisma.invitation.findUnique({
      where: { tokenHash: hashToken(dto.token) },
      select: {
        id: true,
        tenantId: true,
        email: true,
        role: true,
        usedAt: true,
        revokedAt: true,
        expiresAt: true,
        tenant: { select: { status: true } },
      },
    });
    if (
      !invitation ||
      invitation.usedAt !== null ||
      invitation.revokedAt !== null ||
      invitation.expiresAt.getTime() <= now.getTime() ||
      invitation.tenant.status === 'DELETED'
    ) {
      throw new InvalidTokenException();
    }

    // InvitationRole is a subset of Role; the mapping goes through the wire
    // value so there is one place that knows both enums.
    const role = fromWireRole(toWireInvitationRole(invitation.role));
    // Same rule as login: a supervisor/employee of a suspended or cancelled
    // tenant gets no session. Checked before consuming the invitation, so the
    // link still works after the tenant is reactivated.
    assertTenantAllowsAccess(role, invitation.tenant.status);

    // Hashed before the transaction: it is CPU-bound and must not hold a connection.
    const passwordHash = await hashPassword(dto.password);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Race-safe: of two concurrent accepts only one flips the row.
        const consumed = await tx.invitation.updateMany({
          where: {
            id: invitation.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          data: { usedAt: now },
        });
        if (consumed.count !== 1) {
          throw new InvalidTokenException();
        }

        // Tenant, email and role come from the invitation, never the payload.
        const user = await tx.user.create({
          data: {
            tenantId: invitation.tenantId,
            email: invitation.email,
            passwordHash,
            role,
          },
        });
        const pair = await this.tokens.issueTokenPair(
          { id: user.id, tenantId: invitation.tenantId, role: user.role },
          tx,
        );
        return { user, pair };
      });
    } catch (error) {
      // users.email is unique across tenants: the database resolves the race
      // with a registration or another invitation. The transaction rolled back,
      // so the invitation stays unused.
      if (isUniqueViolation(error)) {
        throw new EmailTakenException();
      }
      throw error;
    }

    const { user, pair } = created;
    // After commit; publish never throws (failures are logged without payload).
    await this.events.publish(invitation.tenantId, AUTH_EVENTS.userCreated, {
      userId: user.id,
      tenantId: invitation.tenantId,
      email: user.email,
      name: dto.name,
      role: toWireRole(user.role),
    });

    return pair;
  }
}
