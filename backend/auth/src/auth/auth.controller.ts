import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { AuthService } from './auth.service';
import { AUTH_PATTERNS } from './auth.patterns';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import type { TokenPair } from './token.service';

// Transport only: each handler forwards to one service method.
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @MessagePattern(AUTH_PATTERNS.register)
  register(@Payload() dto: RegisterDto): Promise<TokenPair> {
    return this.authService.register(dto);
  }

  @MessagePattern(AUTH_PATTERNS.login)
  login(@Payload() dto: LoginDto): Promise<TokenPair> {
    return this.authService.login(dto);
  }

  @MessagePattern(AUTH_PATTERNS.tokenRefresh)
  refresh(@Payload() dto: RefreshTokenDto): Promise<TokenPair> {
    return this.authService.refresh(dto);
  }
}
