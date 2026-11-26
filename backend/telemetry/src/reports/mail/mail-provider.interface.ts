export interface ReportEmailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface SendReportEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
  attachment: ReportEmailAttachment;
}

export interface SendReportEmailResult {
  messageId: string;
}

export interface MailProvider {
  sendReportEmail(input: SendReportEmailInput): Promise<SendReportEmailResult>;
}

export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

export function maskEmailAddress(email: string): string {
  const trimmed = email.trim();
  const atIndex = trimmed.indexOf('@');
  if (atIndex <= 0) {
    return '***';
  }
  const local = trimmed.slice(0, atIndex);
  const domain = trimmed.slice(atIndex + 1);
  const visiblePrefix = local.slice(0, 1);
  return `${visiblePrefix}***@${domain}`;
}
