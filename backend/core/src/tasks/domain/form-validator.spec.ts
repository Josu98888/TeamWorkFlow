import { ValidationException } from '../../common/exceptions/app.exceptions';
import { validateFormFields, FormFieldDefinition } from './form-validator';

describe('form-validator', () => {
  it('validates a correct form with all field types', () => {
    const fields: FormFieldDefinition[] = [
      { key: 'comments', label: 'Observaciones', type: 'text', required: false },
      { key: 'temperature', label: 'Temperatura', type: 'number', required: true, min: -10, max: 50 },
      { key: 'lights_on', label: 'Luces encendidas', type: 'yes_no', required: true },
      { key: 'status_select', label: 'Estado', type: 'select', required: true, options: ['OK', 'FALLA'] },
      { key: 'doors_check', label: 'Puertas', type: 'checklist', required: true, options: ['P1', 'P2'] },
      { key: 'evidence', label: 'Foto', type: 'photo', required: true },
      { key: 'qr_checkpoint', label: 'QR', type: 'qr', required: true },
    ];

    expect(validateFormFields(fields)).toEqual(fields);
  });

  it('rejects duplicate keys', () => {
    const fields = [
      { key: 'title', label: 'Titulo 1', type: 'text', required: true },
      { key: 'title', label: 'Titulo 2', type: 'text', required: true },
    ];

    expect(() => validateFormFields(fields)).toThrow(ValidationException);
  });

  it('rejects invalid field types', () => {
    const fields = [
      { key: 'invalid', label: 'Invalido', type: 'video', required: true },
    ];

    expect(() => validateFormFields(fields)).toThrow(ValidationException);
  });

  it('rejects select and checklist without options', () => {
    expect(() =>
      validateFormFields([
        { key: 's1', label: 'Select', type: 'select', required: true, options: [] },
      ]),
    ).toThrow(ValidationException);

    expect(() =>
      validateFormFields([
        { key: 'c1', label: 'Checklist', type: 'checklist', required: true },
      ]),
    ).toThrow(ValidationException);
  });

  it('rejects number min greater than max', () => {
    expect(() =>
      validateFormFields([
        { key: 'num', label: 'Numero', type: 'number', required: true, min: 100, max: 10 },
      ]),
    ).toThrow(ValidationException);
  });

  it('rejects empty array or non-array', () => {
    expect(() => validateFormFields([])).toThrow(ValidationException);
    expect(() => validateFormFields('not-an-array')).toThrow(ValidationException);
  });
});
