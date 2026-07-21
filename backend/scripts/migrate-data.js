/**
 * One-time migration of the legacy users.json flat-file store into the
 * Prisma-backed User/Child tables (see issue #9, Phase 1).
 *
 * Usage: npm run migrate:legacy-users  (from backend/)
 *
 * Safe to re-run: any legacy record whose email already exists as a
 * Prisma User is skipped.
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const LEGACY_USERS_PATH = path.join(__dirname, '..', '..', 'users.json');

// Legacy passwords were hashed with bcryptjs (used by both root server.js and
// backend/routes/auth.js), so the existing hash carries over unchanged.
function mapLegacyUser(legacyUser) {
  return {
    user: {
      email: legacyUser.email,
      name: legacyUser.parentName,
      passwordHash: legacyUser.password,
      role: 'PARENT',
      emailVerified: false,
      // users.json never recorded consent, so this can't be assumed true.
      // Migrated parents must re-confirm consent before any child-scoped
      // write is allowed (see middleware/coppa.js, tracked in #9 Phase 2).
      privacyConsent: false,
      createdAt: legacyUser.createdAt ? new Date(legacyUser.createdAt) : undefined,
    },
    child: {
      name: legacyUser.childName,
      age: legacyUser.childAge,
    },
  };
}

function loadLegacyUsers(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`No legacy users file found at ${filePath}, nothing to migrate.`);
    return [];
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  return parsed.users || [];
}

function isValidLegacyUser(legacyUser) {
  return Boolean(
    legacyUser &&
    legacyUser.email &&
    legacyUser.password &&
    legacyUser.parentName &&
    legacyUser.childName &&
    Number.isInteger(legacyUser.childAge)
  );
}

async function migrate() {
  const prisma = new PrismaClient();
  const legacyUsers = loadLegacyUsers(LEGACY_USERS_PATH);

  let migrated = 0;
  let skipped = 0;
  let invalid = 0;

  try {
    for (const legacyUser of legacyUsers) {
      if (!isValidLegacyUser(legacyUser)) {
        invalid++;
        console.warn(`Skipping malformed legacy record: ${JSON.stringify(legacyUser)}`);
        continue;
      }

      const existing = await prisma.user.findUnique({ where: { email: legacyUser.email } });
      if (existing) {
        skipped++;
        console.log(`Skipping ${legacyUser.email} - already migrated`);
        continue;
      }

      const { user: userData, child: childData } = mapLegacyUser(legacyUser);
      await prisma.user.create({
        data: {
          ...userData,
          children: { create: [childData] },
        },
      });

      migrated++;
      console.log(`Migrated ${legacyUser.email} -> parent + child "${childData.name}"`);
    }
  } finally {
    await prisma.$disconnect();
  }

  console.log(
    `\nDone. Migrated: ${migrated}, Skipped (already present): ${skipped}, Invalid: ${invalid}, Total legacy records: ${legacyUsers.length}`
  );
  if (migrated > 0) {
    console.log(
      'NOTE: migrated accounts have privacyConsent=false — parents must re-confirm consent before child-scoped writes are permitted.'
    );
  }
}

module.exports = { mapLegacyUser, isValidLegacyUser, loadLegacyUsers };

if (require.main === module) {
  migrate().catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });
}
