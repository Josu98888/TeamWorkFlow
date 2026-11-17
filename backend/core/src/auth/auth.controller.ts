import { randomBytes } from 'node:crypto';
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Injectable,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { envs } from '../config';
import { CurrentActor } from '../http/decorators/current-actor.decorator';
import { Public } from '../http/decorators/public.decorator';
import { RequiresFeature } from '../http/decorators/requires-feature.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import type { SocketToken, TokenPair } from './token.service';
import type { VerifiedActor } from './verified-actor';

const REFRESH_COOKIE_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName) {
      out[rawName] = decodeURIComponent(rest.join('='));
    }
  }
  return out;
}

// Secure is on by default (COOKIE_SECURE); never derived from NODE_ENV.
function secureAttribute(): string {
  return envs.cookieSecure ? '; Secure' : '';
}

function setAuthCookies(res: Response | undefined, pair: TokenPair): void {
  if (!res || typeof res.setHeader !== 'function') return;
  const secure = secureAttribute();
  const csrfToken = randomBytes(24).toString('hex');
  const accessMaxAge = Math.max(1, pair.expiresIn);

  res.setHeader('Set-Cookie', [
    `access_token=${encodeURIComponent(pair.accessToken)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${accessMaxAge}${secure}`,
    `refresh_token=${encodeURIComponent(pair.refreshToken)}; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}${secure}`,
    `csrf_token=${encodeURIComponent(csrfToken)}; Path=/; SameSite=Lax; Max-Age=${REFRESH_COOKIE_MAX_AGE_SECONDS}${secure}`,
  ]);
}

function clearAuthCookies(res: Response | undefined): void {
  if (!res || typeof res.setHeader !== 'function') return;
  const secure = secureAttribute();
  res.setHeader('Set-Cookie', [
    `access_token=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`,
    `refresh_token=; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=0${secure}`,
    `csrf_token=; Path=/; SameSite=Lax; Max-Age=0${secure}`,
  ]);
}

// Hydrates `req.body.refreshToken` from the `refresh_token` httpOnly cookie
// before the global ValidationPipe runs when a web client sends an empty body.
@Injectable()
export class CookieRefreshHydratorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (
      typeof body.refreshToken !== 'string' ||
      body.refreshToken.length === 0
    ) {
      const cookies = parseCookies(req.headers?.cookie);
      if (cookies.refresh_token) {
        req.body = { ...body, refreshToken: cookies.refresh_token };
      }
    }
    return true;
  }
}

// HTTP transport only: validate the body (global pipe), call the facade, and
// manage httpOnly session + CSRF cookies for browser clients.
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() body: RegisterDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<TokenPair> {
    const pair = await this.authService.register(body);
    setAuthCookies(res, pair);
    return pair;
  }

  @Public()
  @Post('login')
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<TokenPair> {
    const pair = await this.authService.login(body);
    setAuthCookies(res, pair);
    return pair;
  }

  @Public()
  @UseGuards(CookieRefreshHydratorGuard)
  @Post('refresh')
  async refresh(
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<TokenPair> {
    const pair = await this.authService.refresh(body);
    setAuthCookies(res, pair);
    return pair;
  }

  @UseGuards(CookieRefreshHydratorGuard)
  @Post('logout')
  async logout(
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<{ ok: true }> {
    const result = await this.authService.logout(body);
    clearAuthCookies(res);
    return result;
  }

  // Guarded like every non-public route (cookie + CSRF, or bearer). The token
  // is returned in the body on purpose: JavaScript hands it to the socket
  // handshake. It is never logged and never set as a cookie.
  @RequiresFeature('tower')
  @Post('socket-token')
  socketToken(@CurrentActor() actor: VerifiedActor): Promise<SocketToken> {
    return this.authService.issueSocketToken(actor);
  }
}
