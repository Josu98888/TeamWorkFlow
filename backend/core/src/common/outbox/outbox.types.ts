export type OutboxStatus = 'PENDING' | 'PUBLISHED' | 'FAILED';

export interface OutboxEntry {
  eventId: string;
  tenantId: string;
  subject: string;
  payload: string;
  status: OutboxStatus;
  attempts: number;
  nextRetryAt: Date;
  createdAt: Date;
  publishedAt?: Date | null;
}

export interface OutboxStore {
  save(entry: OutboxEntry): Promise<void>;
  findReadyToPublish(now: Date, limit: number): Promise<OutboxEntry[]>;
  markPublished(eventId: string, publishedAt: Date): Promise<void>;
  markFailedAttempt(
    eventId: string,
    attempts: number,
    nextRetryAt: Date,
    terminal: boolean,
  ): Promise<void>;
}

export type OutboxTransportPublisher = (
  subject: string,
  payload: string,
  options: { msgID: string },
) => Promise<unknown>;

export const OUTBOX_MAX_ATTEMPTS = 20;
export const OUTBOX_INITIAL_BACKOFF_MS = 1_000;
export const OUTBOX_MAX_BACKOFF_MS = 5 * 60_000;

export function outboxBackoffMs(attempts: number): number {
  const delay = OUTBOX_INITIAL_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1));
  return Math.min(delay, OUTBOX_MAX_BACKOFF_MS);
}
