import { isUUID } from 'class-validator';
import { generateUuidV7 } from './uuidv7';

describe('generateUuidV7', () => {
  it('produces valid RFC 9562 UUIDv7 strings accepted by class-validator @IsUUID("7")', () => {
    const id = generateUuidV7(1_700_000_000_000);
    expect(isUUID(id, '7')).toBe(true);
    expect(id.charAt(14)).toBe('7');
    expect(['8', '9', 'a', 'b']).toContain(id.charAt(19));
  });
});
