import { createTransport } from 'nodemailer';
import { MailDeliveryFailedException } from '../../common/exceptions';
import { envs } from '../../config';
import { ReportMailService } from './report-mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

jest.mock('../../config', () => ({
  envs: {
    mailEnabled: true,
    mailFrom: 'no-reply@teamworkflow.local',
    mailProvider: 'smtp',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecure: true,
    smtpUser: 'reportes.empresa@gmail.com',
    smtpPass: 'abcdefghijklmnop',
  },
}));

describe('ReportMailService', () => {
  const mockedCreateTransport = createTransport as jest.MockedFunction<
    typeof createTransport
  >;
  const mutableEnvs = envs as {
    mailEnabled: boolean;
    mailFrom: string;
    mailProvider: 'fake' | 'resend' | 'smtp';
    resendApiKey?: string;
    smtpHost: string;
    smtpPort: number;
    smtpSecure: boolean;
    smtpUser?: string;
    smtpPass?: string;
  };

  let sendMailMock: jest.Mock;
  let closeMock: jest.Mock;
  let service: ReportMailService;

  const sampleInput = {
    to: 'destino@gmail.com',
    subject: '[TeamWorkFlow] Informe Diario',
    text: 'Adjunto informe.',
    html: '<p>Adjunto informe.</p>',
    attachment: {
      filename: 'informe-diario-2026-11-26.pdf',
      content: Buffer.from('%PDF-1.4 sample'),
      contentType: 'application/pdf',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mutableEnvs.mailEnabled = true;
    mutableEnvs.mailFrom = 'no-reply@teamworkflow.local';
    mutableEnvs.mailProvider = 'smtp';
    mutableEnvs.smtpHost = 'smtp.gmail.com';
    mutableEnvs.smtpPort = 465;
    mutableEnvs.smtpSecure = true;
    mutableEnvs.smtpUser = 'reportes.empresa@gmail.com';
    mutableEnvs.smtpPass = 'abcdefghijklmnop';

    sendMailMock = jest
      .fn()
      .mockResolvedValue({ messageId: '<smtp-msg-123@gmail.com>' });
    closeMock = jest.fn();
    mockedCreateTransport.mockReturnValue({
      sendMail: sendMailMock,
      close: closeMock,
    } as never);

    service = new ReportMailService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('sends email with PDF/Excel attachment over SMTP and falls back from .local MAIL_FROM to SMTP_USER', async () => {
    const result = await service.sendReportEmail(sampleInput);

    expect(result).toEqual({ messageId: '<smtp-msg-123@gmail.com>' });
    expect(mockedCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: {
          user: 'reportes.empresa@gmail.com',
          pass: 'abcdefghijklmnop',
        },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledWith({
      from: 'reportes.empresa@gmail.com',
      to: 'destino@gmail.com',
      subject: sampleInput.subject,
      text: sampleInput.text,
      html: sampleInput.html,
      attachments: [
        {
          filename: 'informe-diario-2026-11-26.pdf',
          content: sampleInput.attachment.content,
          contentType: 'application/pdf',
        },
      ],
    });
  });

  it('uses explicit MAIL_FROM when configured to a real domain/address', async () => {
    mutableEnvs.mailFrom = 'rrhh@miempresa.com';

    await service.sendReportEmail(sampleInput);

    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'rrhh@miempresa.com',
      }),
    );
  });

  it('throws MailDeliveryFailedException when SMTP credentials are missing', async () => {
    mutableEnvs.smtpPass = undefined;

    await expect(service.sendReportEmail(sampleInput)).rejects.toBeInstanceOf(
      MailDeliveryFailedException,
    );
    expect(mockedCreateTransport).not.toHaveBeenCalled();
  });

  it('throws MailDeliveryFailedException when SMTP sendMail rejects', async () => {
    sendMailMock.mockRejectedValueOnce(
      Object.assign(new Error('Invalid login'), { code: 'EAUTH' }),
    );

    await expect(service.sendReportEmail(sampleInput)).rejects.toBeInstanceOf(
      MailDeliveryFailedException,
    );
  });

  it('records fake mail in memory when MAIL_ENABLED is false', async () => {
    mutableEnvs.mailEnabled = false;

    const result = await service.sendReportEmail(sampleInput);

    expect(result.messageId).toMatch(/^fake-mail-/);
    expect(service.getSentHistory()).toHaveLength(1);
    expect(mockedCreateTransport).not.toHaveBeenCalled();
  });
});
