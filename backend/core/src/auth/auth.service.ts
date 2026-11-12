import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { hashPassword, hashToken, verifyPassword } from './crypto';
import { normalizeEmail } from '../common/email';
import { assertTenantAllowsAccess } from './tenant-access';
import { isWireRole, toWirePlan, toWireRole, toWireTenantStatus } from './wire';
import { envs } from '../config';
import {
  EmailTakenException,
  InvalidCredentialsException,
  InvalidTokenException,
} from '../common/exceptions/app.exceptions';
import { AUTH_EVENTS } from './events/auth.events';
import { JetStreamService } from './events/jetstream.service';
import { PrismaService } from './prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';
import { RegisterDto } from './dto/register.dto';
import { TokenPair, TokenService } from './token.service';
import type { VerifiedActor } from './verified-actor';

const UNIQUE_VIOLATION = 'P2002';

// AGENTS: Brute-force protection.
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;

// Verified when there is no real hash to check (unknown email, locked
// account), so those paths cost the same Argon2 work as a real attempt.
let dummyHash: Promise<string> | undefined;
function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('timing-equalizer');
  return dummyHash;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
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
      role: toWireRole(user.role),
    });

    return pair;
  }

  // AGENTS: Brute-force protection and Tenant status. Every failure is the
  // same generic error, except tenant_suspended / tenant_cancelled, which are
  // returned only after a correct password.
  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(dto.email) },
      select: {
        id: true,
        tenantId: true,
        role: true,
        passwordHash: true,
        isActive: true,
        failedLoginAttempts: true,
        lockedUntil: true,
        tenant: { select: { status: true } },
      },
    });

    // Unknown email, or locked: no counter change (an attempt during the lock
    // neither counts nor extends it), but the same hashing cost.
    if (
      !user ||
      (user.lockedUntil && user.lockedUntil.getTime() > Date.now())
    ) {
      await verifyPassword(await getDummyHash(), dto.password);
      throw new InvalidCredentialsException();
    }

    const passwordMatches = await verifyPassword(
      user.passwordHash,
      dto.password,
    );

    // Deactivated users and purged tenants are indistinguishable from a wrong
    // password; their failures are not counted.
    if (!user.isActive || user.tenant?.status === 'DELETED') {
      throw new InvalidCredentialsException();
    }

    if (!passwordMatches) {
      await this.recordFailedLogin(user.id);
      throw new InvalidCredentialsException();
    }

    if (user.failedLoginAttempts > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });
    }

    assertTenantAllowsAccess(user.role, user.tenant?.status);

    return this.tokens.issueTokenPair({
      id: user.id,
      tenantId: user.tenantId,
      role: user.role,
    });
  }

  // Rotation (AGENTS: Sessions and tokens): the used token is revoked and a
  // new pair is issued in one transaction. A token rejected because its tenant
  // is blocked is not touched: the status change already revoked those tokens.
  async refresh(dto: RefreshTokenDto): Promise<TokenPair> {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(dto.refreshToken) },
      select: {
        id: true,
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            tenantId: true,
            role: true,
            isActive: true,
            tenant: { select: { status: true } },
          },
        },
      },
    });

    const now = new Date();
    if (
      !stored ||
      stored.revokedAt ||
      stored.expiresAt.getTime() <= now.getTime() ||
      !stored.user.isActive ||
      stored.user.tenant?.status === 'DELETED'
    ) {
      throw new InvalidTokenException();
    }
    const { user } = stored;
    assertTenantAllowsAccess(user.role, user.tenant?.status);

    return this.prisma.$transaction(async (tx) => {
      // Conditional update: of two concurrent refreshes with the same token,
      // only one flips `revokedAt` from null; the other sees count 0.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: stored.id, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count !== 1) {
        throw new InvalidTokenException();
      }
      return this.tokens.issueTokenPair(
        { id: user.id, tenantId: user.tenantId, role: user.role },
        tx,
      );
    });
  }

  // Idempotent: an unknown, expired or already revoked token also answers
  // `{ ok: true }`, so logout reveals nothing about token validity and a double
  // logout is harmless. The conditional update never rewrites `revokedAt`.
  async logout(dto: RefreshTokenDto): Promise<{ ok: true }> {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(dto.refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { ok: true };
  }

  // Called by the gateway on every authenticated request. Signature and expiry
  // come from the token; identity, role, tenant and plan come from the
  // database, so deactivation, role changes and suspension apply immediately.
  async verify(dto: VerifyTokenDto): Promise<VerifiedActor> {
    const claims = await this.readAccessToken(dto.accessToken);

    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        tenantId: true,
        role: true,
        isActive: true,
        siteIds: true,
        tenant: { select: { status: true, plan: true, features: true } },
      },
    });

    if (
      !user ||
      !user.isActive ||
      user.tenant?.status === 'DELETED' ||
      // The tenant of the token must still be the user's tenant.
      claims.tenantId !== user.tenantId
    ) {
      throw new InvalidTokenException();
    }
    assertTenantAllowsAccess(user.role, user.tenant?.status);

    const { tenant } = user;
    return {
      userId: user.id,
      tenantId: user.tenantId,
      role: toWireRole(user.role),
      ...(user.role === 'SUPERVISOR' ? { siteIds: user.siteIds } : {}),
      tenantStatus: tenant ? toWireTenantStatus(tenant.status) : null,
      plan: tenant?.plan ? toWirePlan(tenant.plan) : null,
      features: (tenant?.features as Record<string, boolean> | null) ?? null,
    };
  }

  // Any signature, algorithm, expiry or shape problem is the same error.
  private async readAccessToken(
    accessToken: string,
  ): Promise<{ sub: string; tenantId: string | null }> {
    let claims: unknown;
    try {
      claims = await this.jwt.verifyAsync(accessToken, {
        secret: envs.jwtSecret,
        algorithms: ['HS256'],
      });
    } catch {
      throw new InvalidTokenException();
    }

    const { sub, tenantId, role } = (claims ?? {}) as Record<string, unknown>;
    if (
      typeof sub !== 'string' ||
      sub === '' ||
      !isWireRole(role) ||
      (tenantId !== null && typeof tenantId !== 'string')
    ) {
      throw new InvalidTokenException();
    }
    return { sub, tenantId };
  }

  // The increment is atomic; the 5th consecutive failure sets the lock and
  // resets the counter, so once the lock expires the count starts fresh.
  private async recordFailedLogin(userId: string): Promise<void> {
    const { failedLoginAttempts } = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts >= MAX_FAILED_LOGINS) {
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: 0,
          lockedUntil: new Date(Date.now() + LOCK_DURATION_MS),
        },
      });
    }
  }
}
