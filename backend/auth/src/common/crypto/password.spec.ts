import { hashPassword, verifyPassword } from './password';

// Covers: S3.1
describe('password', () => {
  it('hashes with argon2id', async () => {
    const hash = await hashPassword('correct horse battery staple');

    expect(hash.startsWith('$argon2id$')).toBe(true);
  });

  it('never returns the plain password', async () => {
    const password = 'correct horse battery staple';

    expect(await hashPassword(password)).not.toContain(password);
  });

  it('salts every hash', async () => {
    const password = 'correct horse battery staple';

    expect(await hashPassword(password)).not.toBe(await hashPassword(password));
  });

  it('verifies the right password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(
      verifyPassword(hash, 'correct horse battery staple'),
    ).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');

    await expect(verifyPassword(hash, 'wrong password')).resolves.toBe(false);
  });
});
