import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

// Opts a route out of the global AuthGuard. Telemetry has no public routes
// except `GET /health`; do not use it anywhere else.
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
