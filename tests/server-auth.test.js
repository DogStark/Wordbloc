const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

process.env.JWT_SECRET = 'test-secret-for-auth-regression';
process.env.JWT_EXPIRES_IN = '1h';
process.env.RESEND_API_KEY = '';
process.env.ENABLE_DEBUG_USERS = '';
process.env.USERS_FILE_PATH = path.join(os.tmpdir(), `wordbloc-users-${process.pid}.json`);

const jwt = require('jsonwebtoken');
const app = require('../server.js');

class TestRunner {
  constructor() {
    this.tests = [];
    this.passed = 0;
    this.failed = 0;
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}\nExpected: ${expected}\nActual: ${actual}`);
    }
  }

  assertTrue(condition, message) {
    if (!condition) {
      throw new Error(`${message}\nExpected true, got false`);
    }
  }

  assertFalse(condition, message) {
    if (condition) {
      throw new Error(`${message}\nExpected false, got true`);
    }
  }

  async run() {
    console.log('Running legacy auth server tests...\n');

    for (const test of this.tests) {
      try {
        await test.fn();
        this.passed++;
        console.log(`PASS ${test.name}`);
      } catch (error) {
        this.failed++;
        console.log(`FAIL ${test.name}`);
        console.log(`   ${error.message}`);
      }
    }

    console.log(`\nResults: ${this.passed} passed, ${this.failed} failed`);
    return this.failed === 0;
  }
}

function sampleUser(overrides = {}) {
  return {
    id: 1,
    parentName: 'Canonical Parent',
    email: 'parent@example.test',
    password: '$2a$10$hashedPasswordNotUsedHere',
    childName: 'Canonical Child',
    childAge: 6,
    createdAt: '2026-01-01T00:00:00.000Z',
    emailPreferences: {
      welcome: true,
      achievements: true,
      progress: true,
      milestones: true,
      weekly: true
    },
    ...overrides
  };
}

function authTokenFor(user, options = { expiresIn: '1h' }) {
  return jwt.sign(
    { userId: user.id, email: user.email },
    process.env.JWT_SECRET,
    options
  );
}

function request(method, route, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.listen(0, () => {
      const port = server.address().port;
      const payload = body ? JSON.stringify(body) : null;
      const req = http.request(
        {
          hostname: '127.0.0.1',
          port,
          path: route,
          method,
          headers: {
            ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...headers
          }
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            server.close(() => {
              let parsed = null;
              try {
                parsed = data ? JSON.parse(data) : null;
              } catch (error) {
                reject(error);
                return;
              }

              resolve({ statusCode: res.statusCode, body: parsed, rawBody: data });
            });
          });
        }
      );

      req.on('error', (error) => {
        server.close(() => reject(error));
      });

      if (payload) {
        req.write(payload);
      }

      req.end();
    });
  });
}

const runner = new TestRunner();

runner.test('JWT_SECRET is required with no default fallback', () => {
  const previousSecret = process.env.JWT_SECRET;
  delete process.env.JWT_SECRET;

  let threw = false;
  try {
    app.requireJwtSecret();
  } catch (error) {
    threw = error.message.includes('JWT_SECRET');
  } finally {
    process.env.JWT_SECRET = previousSecret;
  }

  runner.assertTrue(threw, 'missing JWT_SECRET should fail fast');
});

runner.test('signup issues a token and stores only fake test data', async () => {
  app.__setUsersForTest([], 1);

  const response = await request('POST', '/api/auth/signup', {
    parentName: 'Test Parent',
    parentEmail: 'signup@example.test',
    password: 'strongpass',
    childName: 'Test Child',
    childAge: 5
  });

  runner.assertEqual(response.statusCode, 201, 'signup should succeed');
  runner.assertTrue(Boolean(response.body.token), 'signup should return a token');
  runner.assertFalse(Object.prototype.hasOwnProperty.call(response.body.user, 'password'), 'signup response should not expose password');

  const verifyResponse = await request('GET', '/api/auth/verify', null, {
    Authorization: `Bearer ${response.body.token}`
  });

  runner.assertEqual(verifyResponse.statusCode, 200, 'signup token should verify');
  runner.assertEqual(verifyResponse.body.user.email, 'signup@example.test', 'verify should return canonical stored user');
});

runner.test('login issues a token that verify accepts', async () => {
  const loginResponse = await request('POST', '/api/auth/login', {
    email: 'signup@example.test',
    password: 'strongpass'
  });

  runner.assertEqual(loginResponse.statusCode, 200, 'login should succeed');
  runner.assertTrue(Boolean(loginResponse.body.token), 'login should return a token');

  const verifyResponse = await request('GET', '/api/auth/verify', null, {
    Authorization: `Bearer ${loginResponse.body.token}`
  });

  runner.assertEqual(verifyResponse.statusCode, 200, 'login token should verify');
  runner.assertEqual(verifyResponse.body.user.childName, 'Test Child', 'verify should return the stored child name');
});

runner.test('verify returns canonical user data and never returns password hashes', async () => {
  const user = sampleUser();
  const token = authTokenFor(user);
  app.__setUsersForTest([user], 2);

  const response = await request('GET', '/api/auth/verify', null, {
    Authorization: `Bearer ${token}`
  });

  runner.assertEqual(response.statusCode, 200, 'valid token should verify');
  runner.assertEqual(response.body.user.parentName, 'Canonical Parent', 'server user should be canonical');
  runner.assertEqual(response.body.user.childName, 'Canonical Child', 'server child should be canonical');
  runner.assertFalse(Object.prototype.hasOwnProperty.call(response.body.user, 'password'), 'password hash should not be returned');
});

runner.test('verify rejects missing, invalid, and expired tokens', async () => {
  const user = sampleUser();
  app.__setUsersForTest([user], 2);

  const missing = await request('GET', '/api/auth/verify');
  runner.assertEqual(missing.statusCode, 401, 'missing token should be unauthorized');

  const invalid = await request('GET', '/api/auth/verify', null, {
    Authorization: 'Bearer forged-token'
  });
  runner.assertEqual(invalid.statusCode, 401, 'invalid token should be unauthorized');

  const expiredToken = authTokenFor(user, { expiresIn: -1 });
  const expired = await request('GET', '/api/auth/verify', null, {
    Authorization: `Bearer ${expiredToken}`
  });
  runner.assertEqual(expired.statusCode, 401, 'expired token should be unauthorized');
});

runner.test('/api/users does not expose the user list by default', async () => {
  const user = sampleUser();
  const token = authTokenFor(user);
  app.__setUsersForTest([user], 2);

  const unauthenticated = await request('GET', '/api/users');
  runner.assertEqual(unauthenticated.statusCode, 401, 'users endpoint should require authentication');

  const authenticated = await request('GET', '/api/users', null, {
    Authorization: `Bearer ${token}`
  });
  runner.assertEqual(authenticated.statusCode, 404, 'users endpoint should be disabled unless debug access is explicit');
});

runner.test('/api/users exposes public users only when debug access is explicit', async () => {
  const previousDebugFlag = process.env.ENABLE_DEBUG_USERS;
  const user = sampleUser();
  const token = authTokenFor(user);
  app.__setUsersForTest([user], 2);
  process.env.ENABLE_DEBUG_USERS = 'true';

  try {
    const response = await request('GET', '/api/users', null, {
      Authorization: `Bearer ${token}`
    });

    runner.assertEqual(response.statusCode, 200, 'debug users endpoint should be available when enabled');
    runner.assertEqual(response.body.count, 1, 'debug users endpoint should return the user count');
    runner.assertEqual(response.body.users[0].email, 'parent@example.test', 'debug users endpoint should return public user data');
    runner.assertFalse(Object.prototype.hasOwnProperty.call(response.body.users[0], 'password'), 'debug users endpoint should not expose password hashes');
  } finally {
    process.env.ENABLE_DEBUG_USERS = previousDebugFlag;
  }
});

runner.run().then((success) => {
  try {
    fs.unlinkSync(process.env.USERS_FILE_PATH);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!success) {
    process.exit(1);
  }
});
