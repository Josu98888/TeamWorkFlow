import { ApiError } from '@/shared/lib/http';
import { minutesFromNow, mockResponse } from '@/shared/lib/mock';
import { MOCK_USER_ID, TENANT_ID, mockId } from '@/shared/mocks/world';
import type { Form, FormField, FormInput, FormVersion, FormsPage } from './types';

type FormSeed = { name: string; fields: FormField[]; published: boolean };

const SEEDS: readonly FormSeed[] = [
  {
    name: 'Ronda de seguridad',
    published: true,
    fields: [
      { key: 'novedades', label: 'Novedades de la ronda', type: 'text', required: false },
      { key: 'luces_ok', label: 'Iluminación en orden', type: 'yes_no', required: true },
      { key: 'estado', label: 'Estado general', type: 'select', required: true, options: ['Normal', 'Con observaciones', 'Crítico'] },
      { key: 'puertas', label: 'Puertas verificadas', type: 'number', required: true, min: 0, max: 20 },
      { key: 'foto_ronda', label: 'Foto del puesto', type: 'photo', required: true },
    ],
  },
  {
    name: 'Inspección de extintores',
    published: true,
    fields: [
      { key: 'qr_extintor', label: 'QR del extintor', type: 'qr', required: true },
      { key: 'controles', label: 'Controles realizados', type: 'checklist', required: true, options: ['Precinto', 'Manómetro', 'Manguera', 'Vencimiento'] },
      { key: 'foto_extintor', label: 'Foto del extintor', type: 'photo', required: false },
    ],
  },
  {
    name: 'Registro de novedades',
    published: false,
    fields: [{ key: 'detalle', label: 'Detalle', type: 'text', required: true }],
  },
];

let formCounter = SEEDS.length;
let versionCounter = 0;

const FORMS: Form[] = [];

function publish(form: Form): FormVersion {
  versionCounter += 1;
  const version: FormVersion = {
    id: mockId(10, versionCounter),
    tenantId: TENANT_ID,
    formId: form.id,
    version: (form.versions?.[0]?.version ?? 0) + 1,
    name: form.name,
    fields: structuredClone(form.draftFields),
    publishedAt: new Date().toISOString(),
    publishedBy: MOCK_USER_ID,
  };
  form.versions = [version, ...(form.versions ?? [])];
  return version;
}

SEEDS.forEach((seed, index) => {
  const form: Form = {
    id: mockId(9, index + 1),
    tenantId: TENANT_ID,
    name: seed.name,
    draftFields: seed.fields,
    createdBy: MOCK_USER_ID,
    createdAt: minutesFromNow(-5000),
    updatedAt: minutesFromNow(-4000),
    versions: [],
  };
  if (seed.published) publish(form).publishedAt = minutesFromNow(-4000);
  FORMS.push(form);
});

/** Published versions of the demo forms, newest first (the tasks mock attaches them to its tasks). */
export const mockFormVersions = (): FormVersion[] => FORMS.flatMap((form) => form.versions ?? []);

const find = (id: string) => FORMS.find((form) => form.id === id);
const notFound = () => new ApiError(404, 'form_not_found', 'Form not found');
const summary = (form: Form): Form => ({ ...form, versions: undefined });

/** Stateful (in-memory) forms API for the demo mode. */
export const formsMock = {
  listForms: (): Promise<FormsPage> => mockResponse({ items: [...FORMS].reverse().map(summary), total: FORMS.length }),
  getForm: (id: string): Promise<Form> => {
    const form = find(id);
    return form ? mockResponse(structuredClone(form)) : Promise.reject(notFound());
  },
  createForm: (input: FormInput): Promise<Form> => {
    formCounter += 1;
    const now = new Date().toISOString();
    const form: Form = {
      id: mockId(9, formCounter),
      tenantId: TENANT_ID,
      name: input.name,
      draftFields: input.fields,
      createdBy: MOCK_USER_ID,
      createdAt: now,
      updatedAt: now,
      versions: [],
    };
    FORMS.push(form);
    return mockResponse(summary(form));
  },
  updateForm: (id: string, input: Partial<FormInput>): Promise<Form> => {
    const form = find(id);
    if (!form) return Promise.reject(notFound());
    if (input.name !== undefined) form.name = input.name;
    if (input.fields !== undefined) form.draftFields = input.fields;
    form.updatedAt = new Date().toISOString();
    return mockResponse(summary(form));
  },
  publishForm: (id: string): Promise<FormVersion> => {
    const form = find(id);
    return form ? mockResponse(publish(form)) : Promise.reject(notFound());
  },
};
