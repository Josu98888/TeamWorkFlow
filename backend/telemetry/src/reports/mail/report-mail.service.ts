import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { createTransport } from 'nodemailer';
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

const DEFAULT_LOCAL_MAIL_FROM = 'no-reply@teamworkflow.local';
const SMTP_CONNECTION_TIMEOUT_MS = 10_000;
const SMTP_GREETING_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 20_000;

type SmtpTransporter = ReturnType<typeof createTransport>;

@Injectable()
export class ReportMailService implements MailProvider, OnModuleDestroy {
  private readonly logger = new Logger(ReportMailService.name);
  private readonly sentHistory: RecordedReportEmail[] = [];
  private smtpTransporter: SmtpTransporter | null = null;
  private smtpTransporterKey: string | null = null;

  onModuleDestroy(): void {
    if (this.smtpTransporter) {
      this.smtpTransporter.close();
      this.smtpTransporter = null;
      this.smtpTransporterKey = null;
    }
  }

  private getOrCreateSmtpTransporter(config: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  }): SmtpTransporter {
    const key = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.pass}`;
    if (this.smtpTransporter && this.smtpTransporterKey === key) {
      return this.smtpTransporter;
    }
    if (this.smtpTransporter) {
      this.smtpTransporter.close();
    }
    this.smtpTransporter = createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.pass,
      },
      connectionTimeout: SMTP_CONNECTION_TIMEOUT_MS,
      greetingTimeout: SMTP_GREETING_TIMEOUT_MS,
      socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
    });
    this.smtpTransporterKey = key;
    return this.smtpTransporter;
  }

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

    if (envs.mailProvider === 'smtp') {
      if (!envs.smtpHost || !envs.smtpUser || !envs.smtpPass) {
        this.logger.warn(
          'SMTP mail provider is active but SMTP_HOST, SMTP_USER or SMTP_PASS is missing',
        );
        throw new MailDeliveryFailedException();
      }

      const fromAddress =
        envs.mailFrom === DEFAULT_LOCAL_MAIL_FROM && envs.smtpUser.includes('@')
          ? envs.smtpUser
          : envs.mailFrom;

      try {
        const transporter = this.getOrCreateSmtpTransporter({
          host: envs.smtpHost,
          port: envs.smtpPort ?? 465,
          secure: envs.smtpSecure ?? (envs.smtpPort ?? 465) === 465,
          user: envs.smtpUser,
          pass: envs.smtpPass,
        });

        const info = await transporter.sendMail({
          from: fromAddress,
          to: input.to,
          subject: input.subject,
          text: input.text,
          html: input.html,
          attachments: [
            {
              filename: input.attachment.filename,
              content: input.attachment.content,
              contentType: input.attachment.contentType,
            },
          ],
        });

        const messageId =
          typeof info?.messageId === 'string' && info.messageId.length > 0
            ? info.messageId
            : `smtp-${randomUUID()}`;
        return { messageId };
      } catch (err) {
        const code =
          typeof err === 'object' && err !== null && 'code' in err
            ? String((err as { code?: unknown }).code)
            : 'unknown';
        this.logger.warn(`SMTP report email delivery failed (code=${code})`);
        if (err instanceof MailDeliveryFailedException) {
          throw err;
        }
        throw new MailDeliveryFailedException();
      }
    }

    if (envs.mailProvider === 'resend') {
      if (!envs.resendApiKey) {
        this.logger.warn(
          'Resend mail provider is active but RESEND_API_KEY is missing',
        );
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
          this.logger.warn(
            `Resend report email delivery failed (status=${response.status})`,
          );
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
        this.logger.warn('Resend report email delivery request failed');
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
