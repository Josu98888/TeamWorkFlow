import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { MailDeliveryFailedException } from '../../common/exceptions';
import { envs } from '../../config';
import type {
  MailProvider,
  SendReportEmailInput,
  SendReportEmailResult,
} from './mail-provider.interface';

export interface RecordedReportEmail extends SendReportEmailInput {
  messageId: string;
  sentAt: string;
}

@Injectable()
export class ReportMailService implements MailProvider {
  private readonly sentHistory: RecordedReportEmail[] = [];

  async sendReportEmail(
    input: SendReportEmailInput,
  ): Promise<SendReportEmailResult> {
    if (!input.to || !input.to.includes('@')) {
      throw new MailDeliveryFailedException();
    }

    if (!envs.mailEnabled || envs.mailProvider === 'fake') {
      const messageId = `fake-mail-${randomUUID()}`;
      this.sentHistory.push({
        ...input,
        messageId,
        sentAt: new Date().toISOString(),
      });
      if (this.sentHistory.length > 50) {
        this.sentHistory.shift();
      }
      return { messageId };
    }

    if (envs.mailProvider === 'resend') {
      if (!envs.resendApiKey) {
        throw new MailDeliveryFailedException();
      }
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${envs.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: envs.mailFrom,
            to: [input.to],
            subject: input.subject,
            text: input.text,
            html: input.html,
            attachments: [
              {
                filename: input.attachment.filename,
                content: input.attachment.content.toString('base64'),
              },
            ],
          }),
        });
        if (!response.ok) {
          throw new MailDeliveryFailedException();
        }
        const body = (await response.json().catch(() => null)) as {
          id?: string;
        } | null;
        return { messageId: body?.id ?? `resend-${randomUUID()}` };
      } catch (err) {
        if (err instanceof MailDeliveryFailedException) {
          throw err;
        }
        throw new MailDeliveryFailedException();
      }
    }

    throw new MailDeliveryFailedException();
  }

  getSentHistory(): readonly RecordedReportEmail[] {
    return this.sentHistory;
  }

  clearSentHistory(): void {
    this.sentHistory.length = 0;
  }
}
