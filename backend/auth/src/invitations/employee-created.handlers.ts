import { Injectable, OnModuleInit } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { generateOpaqueToken, hashToken } from '../common/crypto';
import { normalizeEmail } from '../common/email';
import { fromWireInvitationRole } from '../common/wire';
import { CONSUMED_SUBJECTS } from '../events/auth.events';
import { ConsumedEventProcessor } from '../events/consumed-event.processor';
import type {
  ConsumedEventContext,
  PostCommitEffect,
} from '../events/consumed-event.processor';
import { PoisonEventError } from '../events/consumed-event.processor';
import { INVITATION_TTL_MS } from './invitation-policy';

const MAX_EMAIL_LENGTH = 254;

// Consumer of `organization.employee_created` (AGENTS § Invitations, Employee
// onboarding). Dedupe by `eventId`, the tenant check and the transaction come
// from `ConsumedEventProcessor`.
//
// The invitation is system-created (`invitedById` null) and its raw token is
// NOT delivered anywhere: AGENTS lists no event for it and there is no email
// provider. Only the hash is stored; the owner/admin gets a usable link with
// `auth.invitation.regenerate`.
@Injectable()
export class EmployeeCreatedHandlers implements OnModuleInit {
  constructor(private readonly processor: ConsumedEventProcessor) {}

  onModuleInit() {
    this.processor.register({
      filter: CONSUMED_SUBJECTS.employeeCreated,
      handle: (context) => this.apply(context),
    });
  }

  async apply({
    tx,
    tenantId,
    payload,
  }: ConsumedEventContext): Promise<PostCommitEffect[]> {
    const email =
      typeof payload.email === 'string' ? normalizeEmail(payload.email) : '';
    // A malformed email can never succeed on redelivery: poison.
    if (email.length > MAX_EMAIL_LENGTH || !isEmail(email)) {
      throw new PoisonEventError();
    }

    // Unknown tenants (nothing to attach the invitation to) and `deleted`
    // ones (purged tombstone) are ignored. `past_due`, `suspended` and
    // `cancelled` tenants still get the invitation: the employee exists, the
    // event is not redelivered later, and access is gated at login anyway.
    const tenant = await tx.tenant.findUnique({
      where: { id: tenantId },
      select: { status: true },
    });
    if (!tenant || tenant.status === 'DELETED') return [];

    // Email is unique across the whole system, so a user in any tenant counts.
    const user = await tx.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (user) return [];

    const now = new Date();
    const pending = await tx.invitation.findFirst({
      where: {
        tenantId,
        email,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (pending) return [];

    await tx.invitation.create({
      data: {
        tenantId,
        email,
        role: fromWireInvitationRole('employee'),
        tokenHash: hashToken(generateOpaqueToken()),
        invitedById: null,
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
      },
    });
    return [];
  }
}
