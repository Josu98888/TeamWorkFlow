import type { FormField } from './types';

export const TEMPLATE_INDUSTRIES = [
  'Seguridad',
  'Limpieza',
  'Logística',
  'Salud',
  'Industria',
] as const;

export type TemplateIndustry = (typeof TEMPLATE_INDUSTRIES)[number];

export type FormTemplate = {
  id: string;
  industry: TemplateIndustry;
  name: string;
  description: string;
  fields: FormField[];
};

export const FORM_TEMPLATES: readonly FormTemplate[] = [
  {
    id: 'seguridad-ronda-perimetral',
    industry: 'Seguridad',
    name: 'Ronda de vigilancia perimetral',
    description: 'Verificación de puntos de control con QR, iluminación, accesos y registro fotográfico.',
    fields: [
      { key: 'qr_punto_control', label: 'QR del punto de control', type: 'qr', required: true },
      { key: 'iluminacion_ok', label: 'Iluminación perimetral operativa', type: 'yes_no', required: true },
      {
        key: 'estado_accesos',
        label: 'Estado de portones y accesos',
        type: 'select',
        required: true,
        options: ['Cerrados y sin novedad', 'Con observación menor', 'Vulnerados / Crítico'],
      },
      { key: 'puertas_revisadas', label: 'Cantidad de accesos verificados', type: 'number', required: true, min: 1, max: 50 },
      { key: 'observaciones_ronda', label: 'Novedades de la ronda', type: 'text', required: false },
      { key: 'foto_puesto', label: 'Foto de verificación del puesto', type: 'photo', required: true },
    ],
  },
  {
    id: 'seguridad-control-accesos',
    industry: 'Seguridad',
    name: 'Control de accesos y visitas',
    description: 'Registro de ingreso de proveedores, contratistas o visitas externas a la sede.',
    fields: [
      { key: 'nombre_visitante', label: 'Nombre completo y DNI / Credencial', type: 'text', required: true },
      {
        key: 'motivo_ingreso',
        label: 'Motivo del ingreso',
        type: 'select',
        required: true,
        options: ['Proveedor / Entrega', 'Mantenimiento técnico', 'Visita administrativa', 'Auditoría'],
      },
      { key: 'autorizado_por', label: 'Responsable interno que autoriza', type: 'text', required: true },
      { key: 'epp_verificado', label: 'Cumple requisitos de ingreso / EPP', type: 'yes_no', required: true },
      { key: 'foto_credencial', label: 'Foto de remito o credencial', type: 'photo', required: false },
    ],
  },
  {
    id: 'limpieza-desinfeccion-sector',
    industry: 'Limpieza',
    name: 'Limpieza y desinfección de sector',
    description: 'Checklist operativo de higiene por área con reposición de insumos y evidencia visual.',
    fields: [
      { key: 'qr_sector', label: 'QR del sector asignado', type: 'qr', required: true },
      {
        key: 'tareas_limpieza',
        label: 'Tareas ejecutadas',
        type: 'checklist',
        required: true,
        options: [
          'Barrido y trapeado de pisos',
          'Desinfección de superficies de alto contacto',
          'Vaciado y recambio de bolsas de residuos',
          'Limpieza de vidrios y aberturas',
        ],
      },
      { key: 'insumos_repuestos', label: 'Insumos repuestos (jabón / papel / alcohol)', type: 'yes_no', required: true },
      { key: 'novedades_mantenimiento', label: 'Desperfectos detectados (pérdidas, roturas)', type: 'text', required: false },
      { key: 'foto_sector_limpio', label: 'Foto del sector finalizado', type: 'photo', required: true },
    ],
  },
  {
    id: 'limpieza-auditoria-sanitarios',
    industry: 'Limpieza',
    name: 'Control e higiene de sanitarios',
    description: 'Inspección periódica de baños y vestuarios en turnos rotativos.',
    fields: [
      {
        key: 'estado_higiene',
        label: 'Nivel de higiene encontrado',
        type: 'select',
        required: true,
        options: ['Óptimo', 'Requiere repasado', 'Crítico / Fuera de servicio'],
      },
      {
        key: 'checklist_sanitario',
        label: 'Verificación de puntos',
        type: 'checklist',
        required: true,
        options: ['Inodoros y mingitorios', 'Lavabos y grifería', 'Dispensers cargados', 'Piso seco y señalizado'],
      },
      { key: 'foto_sanitario', label: 'Evidencia fotográfica', type: 'photo', required: true },
    ],
  },
  {
    id: 'logistica-recepcion-mercaderia',
    industry: 'Logística',
    name: 'Recepción y control de mercadería',
    description: 'Auditoría de descarga en dársena, conteo de bultos y estado de embalaje.',
    fields: [
      { key: 'numero_remito', label: 'Número de remito / orden de compra', type: 'text', required: true },
      { key: 'cantidad_bultos', label: 'Cantidad de bultos recibidos', type: 'number', required: true, min: 1, max: 5000 },
      {
        key: 'estado_carga',
        label: 'Estado del embalaje y pallets',
        type: 'select',
        required: true,
        options: ['Intacto conforme remito', 'Con roturas leves', 'Faltante o daño grave'],
      },
      { key: 'precinto_ok', label: 'Precinto de transporte verificado', type: 'yes_no', required: true },
      { key: 'foto_carga', label: 'Foto de la mercadería en dársena', type: 'photo', required: true },
    ],
  },
  {
    id: 'salud-cadena-frio',
    industry: 'Salud',
    name: 'Control de cadena de frío y bioseguridad',
    description: 'Registro de temperatura de cámaras/heladeras y protocolo de residuos patogénicos.',
    fields: [
      { key: 'qr_equipo', label: 'QR de cámara / heladera', type: 'qr', required: true },
      { key: 'temperatura_celsius', label: 'Temperatura registrada (°C)', type: 'number', required: true, min: -30, max: 25 },
      {
        key: 'protocolo_bioseguridad',
        label: 'Verificación de bioseguridad',
        type: 'checklist',
        required: true,
        options: ['Burletes y cierre hermético', 'Alarma térmica activa', 'Descartadores por debajo del 75%'],
      },
      { key: 'desvio_observaciones', label: 'Acción correctiva ante desvío', type: 'text', required: false },
    ],
  },
  {
    id: 'industria-inspeccion-epp',
    industry: 'Industria',
    name: 'Inspección de seguridad e higiene (EPP)',
    description: 'Control preventivo en planta de elementos de protección personal, matafuegos y salidas.',
    fields: [
      {
        key: 'controles_planta',
        label: 'Puntos auditados en línea',
        type: 'checklist',
        required: true,
        options: [
          'Uso obligatorio de casco, calzado y protección ocular',
          'Extintores despejados y con carga vigente',
          'Salidas de emergencia sin obstrucciones',
          'Tableros eléctricos cerrados y señalizados',
        ],
      },
      { key: 'condicion_insegura', label: '¿Se detectó alguna condición insegura?', type: 'yes_no', required: true },
      { key: 'detalle_hallazgo', label: 'Descripción del hallazgo o sector', type: 'text', required: false },
      { key: 'foto_hallazgo', label: 'Foto de respaldo', type: 'photo', required: false },
    ],
  },
];

export function findFormTemplate(id: string | null | undefined): FormTemplate | undefined {
  if (!id) return undefined;
  return FORM_TEMPLATES.find((tpl) => tpl.id === id);
}