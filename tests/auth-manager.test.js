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
    console.log('Running AuthManager browser tests...\n');

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

class StorageMock {
  constructor(initialValues = {}) {
    this.values = { ...initialValues };
  }

  getItem(key) {
    return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
  }

  setItem(key, value) {
    this.values[key] = String(value);
  }

  removeItem(key) {
    delete this.values[key];
  }
}

function createElement() {
  const classes = new Set();
  return {
    textContent: '',
    className: '',
    innerHTML: '',
    parentNode: null,
    classList: {
      add(name) {
        classes.add(name);
      },
      remove(name) {
        classes.delete(name);
      },
      contains(name) {
        return classes.has(name);
      }
    },
    addEventListener() {},
    remove() {},
    querySelector() {
      return createElement();
    }
  };
}

function setupBrowser({ token = null, user = null, requireAuth = true, fetchImpl }) {
  const elements = {
    userInfo: createElement(),
    welcomeMessage: createElement(),
    logoutBtn: createElement()
  };

  global.localStorage = new StorageMock({
    ...(token ? { spellbloc_token: token } : {}),
    ...(user ? { spellbloc_user: JSON.stringify(user) } : {})
  });
  global.sessionStorage = new StorageMock();
  global.window = {
    SPELLBLOC_REQUIRE_AUTH: requireAuth,
    location: {
      pathname: '/game.html',
      href: ''
    }
  };
  global.document = {
    head: {
      appendChild() {}
    },
    body: {
      appendChild() {}
    },
    createElement,
    getElementById(id) {
      return elements[id] || null;
    },
    addEventListener() {}
  };
  global.fetch = fetchImpl;

  return { elements };
}

setupBrowser({
  requireAuth: false,
  fetchImpl: async () => ({
    ok: false,
    status: 401,
    json: async () => ({})
  })
});

const AuthManager = require('../auth-manager.js');
const runner = new TestRunner();

runner.test('valid stored token is verified and local user cache is replaced with canonical user', async () => {
  const forgedUser = {
    parentName: 'Forged Parent',
    childName: 'Forged Child',
    email: 'forged@example.test'
  };
  const canonicalUser = {
    parentName: 'Server Parent',
    childName: 'Server Child',
    email: 'server@example.test'
  };
  const fetchCalls = [];
  const { elements } = setupBrowser({
    token: 'valid-token',
    user: forgedUser,
    fetchImpl: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: canonicalUser })
      };
    }
  });

  const manager = new AuthManager();
  await manager.authCheckPromise;

  runner.assertTrue(manager.isUserLoggedIn(), 'manager should be logged in after server verification');
  runner.assertEqual(manager.getCurrentUser().childName, 'Server Child', 'current user should come from the server');
  runner.assertEqual(JSON.parse(localStorage.getItem('spellbloc_user')).email, 'server@example.test', 'cached user should be canonical');
  runner.assertEqual(fetchCalls[0].url, '/api/auth/verify', 'manager should call verify endpoint');
  runner.assertEqual(fetchCalls[0].options.headers.Authorization, 'Bearer valid-token', 'manager should send bearer token');
  runner.assertTrue(elements.welcomeMessage.textContent.includes('Welcome back, Server Child!'), 'welcome message should use canonical child name');
  runner.assertFalse(elements.userInfo.classList.contains('hidden'), 'user info should be visible for verified sessions');
});

runner.test('forged localStorage user with invalid token is cleared and redirected', async () => {
  setupBrowser({
    token: 'forged-token',
    user: {
      parentName: 'Forged Parent',
      childName: 'Forged Child',
      email: 'forged@example.test'
    },
    fetchImpl: async () => ({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Invalid or expired token' })
    })
  });

  const manager = new AuthManager();
  await manager.authCheckPromise;

  runner.assertFalse(manager.isUserLoggedIn(), 'manager should not be logged in with invalid token');
  runner.assertEqual(localStorage.getItem('spellbloc_user'), null, 'forged user cache should be removed');
  runner.assertEqual(localStorage.getItem('spellbloc_token'), null, 'invalid token should be removed');
  runner.assertEqual(window.location.href, '/login.html', 'required auth page should redirect to login');
});

runner.test('forged localStorage user without token never becomes logged in', async () => {
  let fetchCalled = false;
  setupBrowser({
    user: {
      parentName: 'Forged Parent',
      childName: 'Forged Child',
      email: 'forged@example.test'
    },
    fetchImpl: async () => {
      fetchCalled = true;
      return {
        ok: true,
        status: 200,
        json: async () => ({ user: {} })
      };
    }
  });

  const manager = new AuthManager();
  await manager.authCheckPromise;

  runner.assertFalse(manager.isUserLoggedIn(), 'manager should not be logged in without a token');
  runner.assertFalse(fetchCalled, 'manager should not call verify without a token');
  runner.assertEqual(localStorage.getItem('spellbloc_user'), null, 'forged user cache should be removed');
  runner.assertEqual(window.location.href, '/login.html', 'required auth page should redirect to login');
});

runner.run().then((success) => {
  if (!success) {
    process.exit(1);
  }
});
