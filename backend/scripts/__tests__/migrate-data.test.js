const { mapLegacyUser, isValidLegacyUser } = require('../migrate-data');

describe('mapLegacyUser', () => {
  const legacyUser = {
    id: 1,
    parentName: 'Test Parent',
    email: 'parent@example.com',
    password: '$2a$10$hashedpasswordvalue',
    childName: 'Test Child',
    childAge: 5,
    createdAt: '2026-03-27T19:07:58.686Z',
  };

  it('maps legacy fields onto the Prisma User shape', () => {
    const { user } = mapLegacyUser(legacyUser);

    expect(user.email).toBe(legacyUser.email);
    expect(user.name).toBe(legacyUser.parentName);
    expect(user.passwordHash).toBe(legacyUser.password);
    expect(user.role).toBe('PARENT');
    expect(user.privacyConsent).toBe(false);
    expect(user.createdAt).toEqual(new Date(legacyUser.createdAt));
  });

  it('maps legacy fields onto the Prisma Child shape', () => {
    const { child } = mapLegacyUser(legacyUser);

    expect(child.name).toBe(legacyUser.childName);
    expect(child.age).toBe(legacyUser.childAge);
  });

  it('leaves createdAt undefined when the legacy record has none', () => {
    const { user } = mapLegacyUser({ ...legacyUser, createdAt: undefined });
    expect(user.createdAt).toBeUndefined();
  });
});

describe('isValidLegacyUser', () => {
  it('accepts a complete legacy record', () => {
    expect(
      isValidLegacyUser({
        email: 'a@example.com',
        password: 'hash',
        parentName: 'Parent',
        childName: 'Child',
        childAge: 6,
      })
    ).toBe(true);
  });

  it.each([
    ['missing email', { password: 'hash', parentName: 'Parent', childName: 'Child', childAge: 6 }],
    ['missing password', { email: 'a@example.com', parentName: 'Parent', childName: 'Child', childAge: 6 }],
    ['non-integer age', { email: 'a@example.com', password: 'hash', parentName: 'Parent', childName: 'Child', childAge: '6' }],
    ['null record', null],
  ])('rejects a record with %s', (_label, record) => {
    expect(isValidLegacyUser(record)).toBe(false);
  });
});
