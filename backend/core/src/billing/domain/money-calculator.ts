import { Decimal } from '@prisma/client/runtime/client';

export interface InvoiceCalculationInput {
  monthlyPrice: Decimal | string;
  billableDays: Decimal | string | number;
  daysInPeriod: Decimal | string | number;
  vatPercent: Decimal | string | number;
}

export interface InvoiceCalculationResult {
  factor: Decimal;
  planAmount: Decimal;
  vatAmount: Decimal;
  subtotal: Decimal;
  total: Decimal;
}

export function toDecimal(val: Decimal | string | number): Decimal {
  if (val instanceof Decimal) {
    return val;
  }
  return new Decimal(val);
}

export function calculateInvoice(
  input: InvoiceCalculationInput,
): InvoiceCalculationResult {
  const price = toDecimal(input.monthlyPrice);
  const billableDays = toDecimal(input.billableDays);
  const daysInPeriod = toDecimal(input.daysInPeriod);
  const vatPercent = toDecimal(input.vatPercent);

  if (daysInPeriod.isZero() || daysInPeriod.isNegative()) {
    throw new Error('daysInPeriod must be positive');
  }
  if (billableDays.isNegative()) {
    throw new Error('billableDays cannot be negative');
  }

  const factor = billableDays.div(daysInPeriod);

  // Plan line: round(price * factor, 2, HALF_UP)
  const planAmount = price
    .mul(factor)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  const subtotal = planAmount;

  // VAT line: round(planLine * (vatPercent / 100), 2, HALF_UP)
  const vatAmount = planAmount
    .mul(vatPercent.div(new Decimal(100)))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

  // Total: exact sum of already rounded lines
  const total = subtotal.plus(vatAmount);

  return {
    factor,
    planAmount,
    vatAmount,
    subtotal,
    total,
  };
}
