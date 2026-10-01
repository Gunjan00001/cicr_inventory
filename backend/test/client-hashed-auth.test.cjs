process.env.DISABLE_ALL_EMAILS = 'true';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbModule = require('../dist/config/database.js');
const { login, resetPassword, decryptLegacyAuth } = require('../dist/modules/auth/auth.controller.js');

const LEGACY_MIGRATION_SECRET = 'CICR_VAULT_LEGACY_AUTH_MIGRATION_KEY_2026';
const LEGACY_MIGRATION_SALT = 'CICR_VAULT_SALT';

function encryptLegacyForTest(plaintext) {
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(LEGACY_MIGRATION_SECRET, LEGACY_MIGRATION_SALT, 1000, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const fullCipher = Buffer.concat([ciphertext, tag]);
  return iv.toString('hex') + ':' + fullCipher.toString('hex');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function mockRes() {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('1. decryptLegacyAuth cleanly decrypts valid AES-GCM migration tokens', () => {
  const original = 'MySecretPass123!';
  const token = encryptLegacyForTest(original);
  const decrypted = decryptLegacyAuth(token);
  assert.equal(decrypted, original);
});

test('2. decryptLegacyAuth returns null on corrupted or invalid tokens', () => {
  assert.equal(decryptLegacyAuth(''), null);
  assert.equal(decryptLegacyAuth('invalid:token'), null);
  assert.equal(decryptLegacyAuth(null), null);
  assert.equal(decryptLegacyAuth(undefined), null);
});

test('3. Direct login with pre-hashed SHA-256 password succeeds against matching bcrypt hash', async () => {
  const rawPass = 'SecretStudent@2026';
  const hashedPass = sha256(rawPass);
  const storedBcrypt = bcrypt.hashSync(hashedPass, 4);

  const mockUser = {
    id: 'usr-1',
    email: 'student1@mail.jiit.ac.in',
    name: 'Student One',
    role: 'MEMBER',
    password_hash: storedBcrypt
  };

  const chain = {
    select() { return chain; },
    eq() { return chain; },
    or() { return chain; },
    limit() { return chain; },
    async maybeSingle() { return { data: mockUser }; },
    update() { return { eq: async () => ({ error: null }) }; }
  };

  const origFrom = dbModule.dbRead.from;
  dbModule.dbRead.from = () => chain;

  try {
    const res = mockRes();
    await login(
      {
        body: { identifier: mockUser.email, password: hashedPass },
        headers: {},
        ip: '127.0.0.1'
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.token);
  } finally {
    dbModule.dbRead.from = origFrom;
  }
});

test('4. Legacy user with unhashed-bcrypt password auto-migrates to SHA-256 on login', async () => {
  const rawPass = 'LegacyPassword123!';
  const clientHashedPass = sha256(rawPass);
  const legacyStoredBcrypt = bcrypt.hashSync(rawPass, 4); // stored from raw plaintext

  let capturedMigratedHash = null;

  const mockUser = {
    id: 'usr-legacy-1',
    email: 'legacy@mail.jiit.ac.in',
    name: 'Legacy Student',
    role: 'MEMBER',
    password_hash: legacyStoredBcrypt
  };

  const chain = {
    select() { return chain; },
    eq() { return chain; },
    or() { return chain; },
    limit() { return chain; },
    async maybeSingle() { return { data: mockUser }; },
    update(data) {
      capturedMigratedHash = data.password_hash;
      return { eq: async () => ({ error: null }) };
    }
  };

  const origRead = dbModule.dbRead.from;
  const origWrite = dbModule.dbWrite.from;
  dbModule.dbRead.from = () => chain;
  dbModule.dbWrite.from = () => chain;

  try {
    const legacyToken = encryptLegacyForTest(rawPass);
    const res = mockRes();
    await login(
      {
        body: {
          identifier: mockUser.email,
          password: clientHashedPass,
          legacy_auth: legacyToken
        },
        headers: {},
        ip: '127.0.0.1'
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'success');
    assert.ok(res.body.token);
    assert.ok(capturedMigratedHash, 'Database must be auto-migrated with new hash');
    // Verify the newly stored bcrypt hash in DB validates the SHA-256 client hash
    assert.equal(bcrypt.compareSync(clientHashedPass, capturedMigratedHash), true);
  } finally {
    dbModule.dbRead.from = origRead;
    dbModule.dbWrite.from = origWrite;
  }
});

test('5. resetPassword accepts client-side SHA-256 hashes and updates DB', async () => {
  const currentRaw = 'OldPass123!';
  const newRaw = 'NewStrongPass2026!';
  const currentHashed = sha256(currentRaw);
  const newHashed = sha256(newRaw);
  const storedCurrentBcrypt = bcrypt.hashSync(currentHashed, 4);

  let capturedUpdate = null;

  const mockUser = {
    id: 'usr-reset-1',
    email: 'resetuser@mail.jiit.ac.in',
    name: 'Reset Student',
    password_hash: storedCurrentBcrypt
  };

  const chain = {
    select() { return chain; },
    eq() { return chain; },
    async maybeSingle() { return { data: mockUser }; },
    update(data) {
      capturedUpdate = data;
      return { eq: async () => ({ error: null }) };
    }
  };

  const origRead = dbModule.dbRead.from;
  const origWrite = dbModule.dbWrite.from;
  dbModule.dbRead.from = () => chain;
  dbModule.dbWrite.from = () => chain;

  try {
    const res = mockRes();
    await resetPassword(
      {
        body: {
          identifier: mockUser.email,
          current_password: currentHashed,
          new_password: newHashed
        }
      },
      res
    );

    assert.equal(res.statusCode, 200);
    assert.ok(capturedUpdate && capturedUpdate.password_hash);
    assert.equal(bcrypt.compareSync(newHashed, capturedUpdate.password_hash), true);
  } finally {
    dbModule.dbRead.from = origRead;
    dbModule.dbWrite.from = origWrite;
  }
});
