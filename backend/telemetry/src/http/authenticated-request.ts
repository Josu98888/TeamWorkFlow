import type { Request } from 'express';
import type { VerifiedActor } from '../nats/dto/nats-contracts';

export type AuthenticatedRequest = Request & {
  actor?: VerifiedActor;
};
