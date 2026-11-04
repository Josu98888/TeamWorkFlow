import { calculateInvoice, toDecimal } from './money-calculator';

describe('money-calculator', () => {
  it('calculates full calendar month correctly', () => {
    const result = calculateInvoice({
      monthlyPrice: '100000.00',
      billableDays: 30,
      daysInPeriod: 30,
      vatPercent: '21',
    });

    expect(result.factor.toString()).toBe('1');
    expect(result.planAmount.toFixed(2)).toBe('100000.00');
    expect(result.vatAmount.toFixed(2)).toBe('21000.00');
    expect(result.subtotal.toFixed(2)).toBe('100000.00');
    expect(result.total.toFixed(2)).toBe('121000.00');
  });

  it('calculates prorated mid-month invoice (AGENTS example: 18 of 30 days)', () => {
    const result = calculateInvoice({
      monthlyPrice: '100000.00',
      billableDays: 18,
      daysInPeriod: 30,
      vatPercent: '21',
    });

    expect(result.factor.toString()).toBe('0.6');
    expect(result.planAmount.toFixed(2)).toBe('60000.00');
    expect(result.vatAmount.toFixed(2)).toBe('12600.00');
    expect(result.subtotal.toFixed(2)).toBe('60000.00');
    expect(result.total.toFixed(2)).toBe('72600.00');
  });

  it('calculates resubscription prorating in a 31-day month', () => {
    // Resubscribed on day 15: 17 billable days of 31
    const result = calculateInvoice({
      monthlyPrice: '50000.00',
      billableDays: 17,
      daysInPeriod: 31,
      vatPercent: '21',
    });

    // 50000 * (17/31) = 27419.3548... -> 27419.35
    expect(result.planAmount.toFixed(2)).toBe('27419.35');
    // 27419.35 * 0.21 = 5758.0635 -> 5758.06
    expect(result.vatAmount.toFixed(2)).toBe('5758.06');
    expect(result.total.toFixed(2)).toBe('33177.41');
  });

  it('applies HALF_UP rounding at boundary conditions', () => {
    // 100.005 rounded to 2 decimals half-up is 100.01
    // price = 100.005 * 1
    const result = calculateInvoice({
      monthlyPrice: '100.005',
      billableDays: 1,
      daysInPeriod: 1,
      vatPercent: '0',
    });

    expect(result.planAmount.toFixed(2)).toBe('100.01');
    expect(result.total.toFixed(2)).toBe('100.01');
  });

  it('handles zero billable days', () => {
    const result = calculateInvoice({
      monthlyPrice: '100000.00',
      billableDays: 0,
      daysInPeriod: 30,
      vatPercent: '21',
    });

    expect(result.planAmount.toFixed(2)).toBe('0.00');
    expect(result.vatAmount.toFixed(2)).toBe('0.00');
    expect(result.total.toFixed(2)).toBe('0.00');
  });

  it('validates invalid periods', () => {
    expect(() =>
      calculateInvoice({
        monthlyPrice: '100.00',
        billableDays: 10,
        daysInPeriod: 0,
        vatPercent: '21',
      }),
    ).toThrow('daysInPeriod must be positive');

    expect(() =>
      calculateInvoice({
        monthlyPrice: '100.00',
        billableDays: -1,
        daysInPeriod: 30,
        vatPercent: '21',
      }),
    ).toThrow('billableDays cannot be negative');
  });
});
