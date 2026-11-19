import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../decorators/public.decorator';

// Shallow liveness probe: no database and no NATS call, so a wake-up ping from
// the platform or an uptime pinger is fast and exposes nothing.
@SkipThrottle()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
