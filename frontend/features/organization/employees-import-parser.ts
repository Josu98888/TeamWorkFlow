import type { BulkImportEmployeeItem } from './types';

export type ParsedImportRow = {
  rowNumber: number;
  nationalId: string;
  fullName: string;
  email: string;
  password: string;
  errors: string[];
};

export type ParsedEmployeesFile = {
  fileName: string;
  rows: ParsedImportRow[];
  validItems: BulkImportEmployeeItem[];
  invalidCount: number;
};

const MAX_ROWS = 200;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;

function isXlsxFile(file: File, bytes: Uint8Array): boolean {
  if (file.name.toLowerCase().endsWith('.xlsx')) return true;
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

function columnLettersToIndex(cellRef: string): number {
  const letters = /^[A-Za-z]+/.exec(cellRef)?.[0].toUpperCase() ?? '';
  if (!letters) return -1;
  let index = 0;
  for (let i = 0; i < letters.length; i++) {
    index = index * 26 + (letters.charCodeAt(i) - 64);
  }
  return index - 1;
}

async function inflateRawBytes(compressed: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Tu navegador no soporta la lectura directa de archivos .xlsx. Guardalo como CSV o TXT.');
  }
  const safeCopy = new Uint8Array(compressed.byteLength);
  safeCopy.set(compressed);
  const stream = new Blob([safeCopy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

async function readZipEntries(bytes: Uint8Array): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocdOffset = -1;
  const minOffset = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minOffset; i--) {
    if (view.getUint32(i, true) === ZIP_EOCD_SIGNATURE) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) {
    throw new Error('El archivo Excel (.xlsx) no tiene una estructura válida.');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const decoder = new TextDecoder('utf-8');
  const extracted = new Map<string, string>();

  let cursor = centralDirOffset;
  for (let entry = 0; entry < totalEntries && cursor + 46 <= bytes.length; entry++) {
    if (view.getUint32(cursor, true) !== ZIP_CENTRAL_SIGNATURE) break;
    const compressionMethod = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);
    const name = decoder.decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));
    cursor += 46 + nameLen + extraLen + commentLen;

    const isSharedStrings = name === 'xl/sharedStrings.xml';
    const isWorksheet = name.startsWith('xl/worksheets/') && name.endsWith('.xml');
    if (!isSharedStrings && !isWorksheet) continue;

    if (localHeaderOffset + 30 > bytes.length) continue;
    if (view.getUint32(localHeaderOffset, true) !== ZIP_LOCAL_SIGNATURE) continue;
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = bytes.subarray(dataStart, dataStart + compressedSize);

    if (compressionMethod === 0) {
      extracted.set(name, decoder.decode(compressedSlice));
    } else if (compressionMethod === 8) {
      extracted.set(name, await inflateRawBytes(compressedSlice));
    }
  }

  return extracted;
}

function parseSharedStrings(xmlText: string | undefined): string[] {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const items = Array.from(doc.getElementsByTagName('si'));
  return items.map((si) =>
    Array.from(si.getElementsByTagName('t'))
      .map((t) => t.textContent ?? '')
      .join(''),
  );
}

function parseWorksheetRows(sheetXml: string, sharedStrings: string[]): string[][] {
  const doc = new DOMParser().parseFromString(sheetXml, 'application/xml');
  const rowNodes = Array.from(doc.getElementsByTagName('row'));
  const rows: string[][] = [];

  for (const rowNode of rowNodes) {
    const cellNodes = Array.from(rowNode.getElementsByTagName('c'));
    const cells: string[] = [];
    cellNodes.forEach((cell, fallbackIndex) => {
      const ref = cell.getAttribute('r') ?? '';
      const colIndex = ref ? columnLettersToIndex(ref) : fallbackIndex;
      const targetIndex = colIndex >= 0 ? colIndex : fallbackIndex;
      const cellType = cell.getAttribute('t');

      let value = '';
      if (cellType === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('');
      } else {
        const rawValue = cell.getElementsByTagName('v')[0]?.textContent ?? '';
        if (cellType === 's') {
          const idx = Number(rawValue);
          value = Number.isInteger(idx) ? (sharedStrings[idx] ?? '') : '';
        } else {
          value = rawValue;
        }
      }
      cells[targetIndex] = value.trim();
    });
    rows.push(cells);
  }

  return rows;
}

async function extractRawRowsFromXlsx(bytes: Uint8Array): Promise<string[][]> {
  const entries = await readZipEntries(bytes);
  const sharedStrings = parseSharedStrings(entries.get('xl/sharedStrings.xml'));
  const sheetName =
    entries.has('xl/worksheets/sheet1.xml')
      ? 'xl/worksheets/sheet1.xml'
      : Array.from(entries.keys())
          .filter((key) => key.startsWith('xl/worksheets/') && key.endsWith('.xml'))
          .sort()[0];

  if (!sheetName) {
    throw new Error('No se encontró ninguna hoja de cálculo en el archivo Excel.');
  }
  const sheetXml = entries.get(sheetName) ?? '';
  const matrix = parseWorksheetRows(sheetXml, sharedStrings);

  return matrix
    .map((cells) => {
      const nonEmpty = cells.filter((cell) => (cell ?? '').trim().length > 0);
      if (nonEmpty.length === 0) return [];
      const firstCell = (cells[0] ?? '').trim();
      if (firstCell.includes('|') && nonEmpty.length === 1) {
        return firstCell.split('|').map((part) => part.trim());
      }
      return [cells[0] ?? '', cells[1] ?? '', cells[2] ?? '', cells[3] ?? ''].map((part) =>
        part.trim(),
      );
    })
    .filter((row) => row.length > 0 && row.some((cell) => cell.length > 0));
}

function splitDelimitedLine(line: string): string[] {
  if (line.includes('|')) return line.split('|').map((part) => part.trim());
  if (line.includes(';')) return line.split(';').map((part) => part.trim());
  if (line.includes('\t')) return line.split('\t').map((part) => part.trim());
  return line.split(',').map((part) => part.trim());
}

function extractRawRowsFromText(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, '');
  return cleaned
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(splitDelimitedLine);
}

function isHeaderRow(cells: string[]): boolean {
  const col0 = (cells[0] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const col1 = (cells[1] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const col2 = (cells[2] ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    (col0 === 'dni' || col0 === 'documento' || col0 === 'nationalid') &&
    (col1.includes('nombre') || col2.includes('email') || col2.includes('correo') || col2.includes('mail'))
  );
}

function sanitizeDni(raw: string): string {
  const trimmed = raw.trim();
  if (/^[\d.\s-]+$/.test(trimmed)) {
    return trimmed.replace(/[.\s-]/g, '');
  }
  return trimmed;
}

/**
 * Parses an Excel (`.xlsx`) or pipe/CSV text file structured as:
 * `DNI|NombreApellido|email|contrasena` (either in a single `|`-delimited column or in 4 columns).
 */
export async function parseEmployeesImportFile(file: File): Promise<ParsedEmployeesFile> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const rawRows = isXlsxFile(file, bytes)
    ? await extractRawRowsFromXlsx(bytes)
    : extractRawRowsFromText(new TextDecoder('utf-8').decode(bytes));

  if (rawRows.length === 0) {
    throw new Error('El archivo está vacío o no contiene filas con datos.');
  }

  const hasHeader = isHeaderRow(rawRows[0] ?? []);
  const dataRows = hasHeader ? rawRows.slice(1) : rawRows;

  if (dataRows.length === 0) {
    throw new Error('El archivo solo contiene el encabezado y ninguna fila de usuarios.');
  }
  if (dataRows.length > MAX_ROWS) {
    throw new Error(`El archivo supera el máximo permitido de ${MAX_ROWS} usuarios por carga.`);
  }

  const seenEmails = new Set<string>();
  const seenDnis = new Set<string>();
  const rows: ParsedImportRow[] = [];
  const validItems: BulkImportEmployeeItem[] = [];

  dataRows.forEach((cells, index) => {
    const rowNumber = hasHeader ? index + 2 : index + 1;
    const nationalId = sanitizeDni(cells[0] ?? '');
    const fullName = (cells[1] ?? '').trim();
    const email = (cells[2] ?? '').trim().toLowerCase();
    const password = cells[3] ?? '';
    const errors: string[] = [];

    if (cells.length < 4) {
      errors.push('Formato incompleto: se esperan 4 campos (DNI|NombreApellido|email|contrasena).');
    }
    if (!nationalId) {
      errors.push('Falta el DNI.');
    } else if (nationalId.length > 40) {
      errors.push('El DNI supera los 40 caracteres.');
    } else if (seenDnis.has(nationalId.toLowerCase())) {
      errors.push('DNI duplicado dentro del mismo archivo.');
    } else {
      seenDnis.add(nationalId.toLowerCase());
    }

    if (!fullName) {
      errors.push('Falta Nombre y Apellido.');
    } else if (fullName.length > 200) {
      errors.push('El nombre supera los 200 caracteres.');
    }

    if (!email) {
      errors.push('Falta el email.');
    } else if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
      errors.push('Formato de email inválido.');
    } else if (seenEmails.has(email)) {
      errors.push('Email duplicado dentro del mismo archivo.');
    } else {
      seenEmails.add(email);
    }

    if (!password) {
      errors.push('Falta la contraseña.');
    } else if (password.length < 8) {
      errors.push('La contraseña debe tener al menos 8 caracteres.');
    } else if (password.length > 128) {
      errors.push('La contraseña supera los 128 caracteres.');
    }

    rows.push({
      rowNumber,
      nationalId,
      fullName,
      email,
      password,
      errors,
    });

    if (errors.length === 0) {
      validItems.push({
        nationalId,
        fullName,
        email,
        password,
      });
    }
  });

  const invalidCount = rows.length - validItems.length;
  return {
    fileName: file.name,
    rows,
    validItems,
    invalidCount,
  };
}

export function buildSampleEmployeesImportContent(): string {
  return [
    'DNI|NombreApellido|email|contrasena',
    '35123456|Juan Perez|juan.perez@empresa.com|ClaveSegura123',
    '38987654|Maria Gomez|maria.gomez@empresa.com|Acceso2026!',
  ].join('\n');
}
