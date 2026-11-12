import { Injectable, OnModuleInit } from '@nestjs/common';
import { normalizeEmail } from '../../common/email';
import { CONSUMED_SUBJECTS } from '../events/consumed-events';
import {
  ConsumedEventProcessor,
  PoisonEventError,
  type ConsumedEventContext,
  type PostCommitEffect,
} from '../events/consumed-event.processor';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EMAIL_LENGTH = 254;

// `auth` sends one `name`; the profile has first and last name. The first word
// is the first name, the rest the last name.
export function splitName(name: string, email: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return { firstName: email.split('@')[0], lastName: '' };
  }
  return { firstName: words[0], lastName: words.slice(1).join(' ') };
}

// Consumer of `t.<tenant>.auth.user_created` (AGENTS § Employees rule 3): link
// the user to the employee of the tenant with the same email, else create a
// profile without legajo. Dedupe by `eventId`, the tenant check and the
// transaction come from `ConsumedEventProcessor`; a redelivery that already
// ran is a no-op, and the writes are also idempotent by their natural keys.
@Injectable()
export class UserCreatedHandler implements OnModuleInit {
  constructor(private readonly processor: ConsumedEventProcessor) {}

  onModuleInit() {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.userCreated,
      handle: (context) => this.apply(context),
    });
  }

  async apply({
    tx,
    tenantId,
    payload,
  }: ConsumedEventContext): Promise<PostCommitEffect[]> {
    const { userId, name } = payload;
    const email =
      typeof payload.email === 'string' ? normalizeEmail(payload.email) : '';
    // Fields that can never become valid on redelivery: poison.
    if (
      typeof userId !== 'string' ||
      !UUID.test(userId) ||
      typeof name !== 'string' ||
      email.length === 0 ||
      email.length > MAX_EMAIL_LENGTH
    ) {
      throw new PoisonEventError();
    }

    // The user is already linked in this tenant: nothing to do.
    const linked = await tx.employee.findFirst({
      where: { tenantId, userId },
      select: { id: true },
    });
    if (linked) return [];

    const existing = await tx.employee.findFirst({
      where: { tenantId, email },
      select: { id: true, userId: true },
    });
    if (existing) {
      // Linked to a different user already: keep it, never overwrite.
      if (existing.userId === null) {
        await tx.employee.updateMany({
          where: { id: existing.id, tenantId, userId: null },
          data: { userId },
        });
      }
      return [];
    }

    await tx.employee.create({
      data: { tenantId, userId, email, ...splitName(name, email) },
    });
    return [];
  }
}
