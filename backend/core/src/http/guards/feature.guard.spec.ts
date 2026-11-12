import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { FeatureNotInPlanException } from '../../common/exceptions/app.exceptions';
import { FeatureGuard } from './feature.guard';

describe('FeatureGuard', () => {
  let guard: FeatureGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new FeatureGuard(reflector);
  });

  function createContext(actor: any): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ actor }),
      }),
    } as unknown as ExecutionContext;
  }

  it('allows access when route requires no feature', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const context = createContext({ features: {} });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows access when actor has required feature enabled', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tasks');
    const context = createContext({
      features: { tasks: true, alerts: true },
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  it('throws FeatureNotInPlanException (403) when actor lacks required feature', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tasks');
    const context = createContext({
      features: { tasks: false, alerts: false },
    });

    expect(() => guard.canActivate(context)).toThrow(
      FeatureNotInPlanException,
    );
  });

  it('throws FeatureNotInPlanException (403) when actor has null features', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue('tasks');
    const context = createContext({
      features: null,
    });

    expect(() => guard.canActivate(context)).toThrow(
      FeatureNotInPlanException,
    );
  });
});
