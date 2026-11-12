import {
  AnswerTooOldException,
  QrMismatchException,
  ValidationException,
} from '../../common/exceptions/app.exceptions';
import type { FormFieldDefinition } from './form-validator';
import { validateTaskAnswers } from './answer-validator';

describe('answer-validator', () => {
  const formFields: FormFieldDefinition[] = [
    { key: 'notes', label: 'Notas', type: 'text', required: false },
    { key: 'count', label: 'Cantidad', type: 'number', required: true, min: 1, max: 100 },
    { key: 'approved', label: 'Aprobado', type: 'yes_no', required: true },
    { key: 'category', label: 'Categoria', type: 'select', required: true, options: ['A', 'B'] },
    { key: 'items', label: 'Items', type: 'checklist', required: true, options: ['I1', 'I2'] },
    { key: 'photo', label: 'Foto', type: 'photo', required: true },
    { key: 'checkpoint', label: 'QR', type: 'qr', required: true },
  ];

  const now = new Date('2026-11-12T12:00:00.000Z');
  const validDeviceTime = new Date('2026-11-12T11:55:00.000Z');
  const validPhotoId = '019323ea-3d3a-7347-8fae-c0498b584033';

  it('validates a complete, matching answers payload', () => {
    const answers = {
      notes: 'Todo en orden',
      count: 5,
      approved: true,
      category: 'A',
      items: ['I1'],
      photo: validPhotoId,
      checkpoint: 'QR-SITE-1-P1',
    };

    const sanitized = validateTaskAnswers({
      submittedAnswers: answers,
      formFields,
      expectedQr: 'QR-SITE-1-P1',
      deviceTime: validDeviceTime,
      now,
    });

    expect(sanitized).toEqual(answers);
  });

  it('throws AnswerTooOldException when device timestamp is older than 24 hours', () => {
    const oldDeviceTime = new Date(now.getTime() - 25 * 60 * 60 * 1000);

    expect(() =>
      validateTaskAnswers({
        submittedAnswers: {},
        formFields,
        deviceTime: oldDeviceTime,
        now,
      }),
    ).toThrow(AnswerTooOldException);
  });

  it('throws QrMismatchException when QR code does not match expectedQr', () => {
    const answers = {
      count: 5,
      approved: true,
      category: 'A',
      items: ['I1'],
      photo: validPhotoId,
      checkpoint: 'WRONG-QR',
    };

    expect(() =>
      validateTaskAnswers({
        submittedAnswers: answers,
        formFields,
        expectedQr: 'QR-SITE-1-P1',
        deviceTime: validDeviceTime,
        now,
      }),
    ).toThrow(QrMismatchException);
  });

  it('throws ValidationException when required field is missing or invalid', () => {
    expect(() =>
      validateTaskAnswers({
        submittedAnswers: {
          count: 0, // min is 1
          approved: 'not-a-bool',
        },
        formFields,
        deviceTime: validDeviceTime,
        now,
      }),
    ).toThrow(ValidationException);
  });
});
