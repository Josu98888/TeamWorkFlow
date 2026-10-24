import { parseDurationSeconds } from './duration';

// Covers: S3.2
describe('parseDurationSeconds', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['7d', 604800],
  ])('parses %s to %i seconds', (input, expected) => {
    expect(parseDurationSeconds(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '1.5h', '-5m', '5w', '15 m'])(
    'rejects %p',
    (input) => {
      expect(() => parseDurationSeconds(input)).toThrow('Invalid duration');
    },
  );
});
