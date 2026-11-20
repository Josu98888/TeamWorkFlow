import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { generateOpaqueToken, hashToken } from './crypto';
import { SOCKET_TOKEN_TYP } from './dto/verify-token.dto';
import { parseDurationSeconds } from '../common/duration';
import { toWireRole, type WireRole } from './wire';
import { envs } from '../config';
import type { Role } from './prisma/generated/enums';
import { PrismaService } from './prisma/prisma.service';

export interface TokenSubject {
  id: string;
  // Null only for PLATFORM_ADMIN.
  tenantId: string | null;
  role: Role;
}

export interface TokenPair {
  accessToken: string;
  // Raw opaque value: returned once, only its hash is stored.
  refreshToken: string;
  // Access token lifetime in seconds.
  expiresIn: number;
}

// Built from the verified actor, so the role is already the wire value.
export interface SocketTokenSubject {
  userId: string;
  tenantId: string;
  role: WireRole;
}

export interface SocketToken {
  token: string;
  // Lifetime in seconds.
  expiresIn: number;
}

// The socket token is only a ticket to open the Torre de Control WebSocket
// handshake, so it lives for seconds, not minutes.
export const SOCKET_TOKEN_TTL_SECONDS = 60;

// Subset of the Prisma client that works for both the service and a
// `$transaction` client, so callers can issue a pair inside their transaction.
export type RefreshTokenWriter = Pick<PrismaService, 'refreshToken'>;

@Injectable()
export class TokenService {
  private readonly accessTtlSeconds = parseDurationSeconds(envs.accessTokenTtl);
  private readonly refreshTtlMs =
    parseDurationSeconds(envs.refreshTokenTtl) * 1000;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async issueTokenPair(
    user: TokenSubject,
    db: RefreshTokenWriter = this.prisma,
  ): Promise<TokenPair> {
    // Claims are exactly sub, tenantId, role, jti, iat, exp: no personal data.
    const accessToken = await this.jwt.signAsync(
      { tenantId: user.tenantId, role: toWireRole(user.role) },
      {
        subject: user.id,
        jwtid: randomUUID(),
        expiresIn: this.accessTtlSeconds,
      },
    );

    const refreshToken = generateOpaqueToken();
    await db.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTtlMs),
      },
    });

    return { accessToken, refreshToken, expiresIn: this.accessTtlSeconds };
  }

  // Same secret and HS256 as the access token: what keeps the two kinds apart is
  // the `typ` claim, which every verifier checks (access rejects it, socket
  // requires it). Claims: sub, tenantId, role, typ, jti, iat, exp.
  async issueSocketToken(actor: SocketTokenSubject): Promise<SocketToken> {
    const token = await this.jwt.signAsync(
      { tenantId: actor.tenantId, role: actor.role, typ: SOCKET_TOKEN_TYP },
      {
        subject: actor.userId,
        jwtid: randomUUID(),
        expiresIn: SOCKET_TOKEN_TTL_SECONDS,
      },
    );
    return { token, expiresIn: SOCKET_TOKEN_TTL_SECONDS };
  }
}
