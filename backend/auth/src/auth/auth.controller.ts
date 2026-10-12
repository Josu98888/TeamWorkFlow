import { Controller } from '@nestjs/common';
import { AuthService } from './auth.service';

// Session handlers (`AUTH_PATTERNS`) are added in STEPS Phase 3.
@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}
}
