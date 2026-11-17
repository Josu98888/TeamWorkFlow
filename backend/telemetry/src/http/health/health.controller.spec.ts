import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();

  it('answers { status: ok }', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
  });

  it('is marked @Public() so the global AuthGuard lets it through', () => {
    const handler = Object.getOwnPropertyDescriptor(
      HealthController.prototype,
      'check',
    )?.value as () => void;
    const isPublic = new Reflector().get<boolean>(IS_PUBLIC_KEY, handler);
    expect(isPublic).toBe(true);
  });
});
