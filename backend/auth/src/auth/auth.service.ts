import { Injectable, Logger } from '@nestjs/common';
import { hashPassword } from '../common/crypto';
import { normalizeEmail } from '../common/email';
import { EmailTakenException } from '../common/exceptions/app.exceptions';
import { AUTH_EVENTS } from '../events/auth.events';
import { JetStreamService } from '../events/jetstream.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { TokenPair, TokenService } from './token.service';

const UNIQUE_VIOLATION = 'P2002';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

// Session use cases (login, tokens) are added in STEPS Phase 3.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly events: JetStreamService,
  ) {}

  // Creates a tenant and its OWNER in one transaction (AGENTS § Tenants and
  // registration). The role is fixed here, never read from the payload.
  async register(dto: RegisterDto): Promise<TokenPair> {
    const email = normalizeEmail(dto.email);
    // Hashed before the transaction: it is CPU-bound and must not hold a connection.
    const passwordHash = await hashPassword(dto.password);

    let created;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: { name: dto.tenantName, status: 'ACTIVE' },
        });
        const user = await tx.user.create({
          data: { tenantId: tenant.id, email, passwordHash, role: 'OWNER' },
        });
        const pair = await this.tokens.issueTokenPair(
          { id: user.id, tenantId: tenant.id, role: user.role },
          tx,
        );
        return { tenant, user, pair };
      });
    } catch (error) {
      // The unique index on users.email is the only unique constraint a new
      // tenant/user/refresh token can violate; the database resolves the race.
      if (isUniqueViolation(error)) {
        throw new EmailTakenException();
      }
      throw error;
    }

    const { tenant, user, pair } = created;
    // After commit; publish never throws (failures are logged without payload).
    await this.events.publish(tenant.id, AUTH_EVENTS.tenantCreated, {
      tenantId: tenant.id,
      name: tenant.name,
      ownerId: user.id,
    });
    await this.events.publish(tenant.id, AUTH_EVENTS.userCreated, {
      userId: user.id,
      tenantId: tenant.id,
      email: user.email,
      name: dto.name,
      role: user.role,
    });

    return pair;
  }
}
