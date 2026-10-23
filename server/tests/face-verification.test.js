const assert = require('node:assert/strict');
const { after, before, test } = require('node:test');
const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const FaceEnrollment = require('../models/FaceEnrollment');
const FaceVerificationEvent = require('../models/FaceVerificationEvent');
const {
  averageEmbeddings,
  cosineSimilarity,
  validateEmbedding
} = require('../face-verification/embeddings');
const {
  TemplateIntegrityError,
  decryptEmbedding,
  encryptEmbedding
} = require('../face-verification/template-crypto');
const { createUserRateLimiter } = require('../face-verification/rate-limit');

const secret = 'test-jwt-secret';
const userId = new crypto.randomBytes(12).toString('hex');
process.env.JWT_SECRET = secret;

const router = require('../routes/face-verification');
const app = express();
app.use('/api/face-verification', router);

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

test('cosine similarity handles identical and orthogonal embeddings', () => {
  const same = Array(128).fill(0);
  same[0] = 1;
  const orthogonal = Array(128).fill(0);
  orthogonal[1] = 1;

  assert.equal(cosineSimilarity(same, same), 1);
  assert.equal(cosineSimilarity(same, orthogonal), 0);
});

test('embedding validation rejects incompatible, zero, and non-finite vectors', () => {
  assert.throws(() => validateEmbedding([1, 2]), /128 values/);
  assert.throws(() => validateEmbedding(Array(128).fill(0)), /non-zero/);
  const nonFinite = Array(128).fill(1);
  nonFinite[4] = Number.NaN;
  assert.throws(() => validateEmbedding(nonFinite), /finite/);
  nonFinite[4] = Number.POSITIVE_INFINITY;
  assert.throws(() => validateEmbedding(nonFinite), /finite/);
});

test('per-user rate limiter rejects a repeated request with retry guidance', () => {
  const limiter = createUserRateLimiter({ limit: 1, windowMs: 60_000 });
  let nextCount = 0;
  let statusCode = 200;
  const headers = {};
  const body = {};
  const response = {
    set: (name, value) => { headers[name] = value; },
    status: (code) => {
      statusCode = code;
      return response;
    },
    json: (value) => Object.assign(body, value)
  };

  limiter({ user: { id: userId } }, response, () => { nextCount += 1; });
  limiter({ user: { id: userId } }, response, () => { nextCount += 1; });

  assert.equal(nextCount, 1);
  assert.equal(statusCode, 429);
  assert.ok(Number(headers['Retry-After']) > 0);
  assert.equal(body.reasonCode, 'RATE_LIMITED');
});

test('enrollment sample embeddings are normalized and averaged', () => {
  const first = Array(128).fill(0);
  first[0] = 1;
  const second = Array(128).fill(0);
  second[0] = 1;
  second[1] = 1;
  const average = averageEmbeddings([first, second]);

  assert.equal(average.length, 128);
  assert.ok(Math.abs(Math.hypot(...average) - 1) < 1e-12);
  assert.throws(() => averageEmbeddings([first]), /two or three/);
});

test('encrypted templates round-trip and tampering is rejected', () => {
  process.env.FACE_TEMPLATE_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
  const embedding = Array(128).fill(0);
  embedding[0] = 1;
  const encrypted = encryptEmbedding(embedding);
  assert.deepEqual(decryptEmbedding(encrypted), embedding);

  encrypted.ciphertext = Buffer.from('tampered').toString('base64');
  assert.throws(() => decryptEmbedding(encrypted), TemplateIntegrityError);
});

test('face enrollment state rejects unauthenticated access', async () => {
  const response = await fetch(`${baseUrl}/api/face-verification/enrollment`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).success, false);
});

test('face enrollment state is scoped to the authenticated user, not a request parameter', async (context) => {
  const originalFindById = User.findById;
  const originalFindOne = FaceEnrollment.findOne;
  let lookedUpUserId;

  context.after(() => {
    User.findById = originalFindById;
    FaceEnrollment.findOne = originalFindOne;
  });

  User.findById = (id) => {
    lookedUpUserId = String(id);
    return {
      select: async () => ({ _id: userId, role: 'student', isVerified: true })
    };
  };
  FaceEnrollment.findOne = (query) => {
    assert.deepEqual(query, { userId });
    return {
      select: () => ({
        lean: async () => null
      })
    };
  };

  const token = jwt.sign({ id: userId }, secret);
  const response = await fetch(
    `${baseUrl}/api/face-verification/enrollment?userId=${crypto.randomBytes(12).toString('hex')}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  assert.equal(response.status, 200);
  assert.equal(lookedUpUserId, userId);
  assert.deepEqual(await response.json(), {
    success: true,
    enrolled: false,
    modelVersion: null,
    consentedAt: null
  });
});

test('face enrollment state rejects teacher accounts', async (context) => {
  const originalFindById = User.findById;
  context.after(() => {
    User.findById = originalFindById;
  });
  User.findById = () => ({
    select: async () => ({ _id: userId, role: 'teacher', isVerified: true })
  });

  const token = jwt.sign({ id: userId }, secret);
  const response = await fetch(`${baseUrl}/api/face-verification/enrollment`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).reasonCode, 'STUDENT_ACCOUNT_REQUIRED');
});

test('face preview and verification reject camera images without explicit consent', async (context) => {
  const originalFindById = User.findById;
  context.after(() => {
    User.findById = originalFindById;
  });
  User.findById = () => ({
    select: async () => ({ _id: userId, role: 'student', isVerified: true })
  });

  const token = jwt.sign({ id: userId }, secret);
  for (const endpoint of ['preview', 'verify']) {
    const form = new FormData();
    form.append('capture', new Blob([Buffer.from('jpeg-placeholder')], { type: 'image/jpeg' }), 'capture.jpg');
    const response = await fetch(`${baseUrl}/api/face-verification/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token },
      body: form
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).reasonCode, 'BIOMETRIC_CONSENT_REQUIRED');
  }
});

test('face verification returns inconclusive when the inference service is unavailable', async (context) => {
  const originalFindById = User.findById;
  const originalFindOne = FaceEnrollment.findOne;
  const originalCreate = FaceVerificationEvent.create;
  const originalToken = process.env.FACE_SERVICE_TOKEN;
  const originalEncryptionKey = process.env.FACE_TEMPLATE_ENCRYPTION_KEY;
  const originalThreshold = process.env.FACE_MATCH_THRESHOLD;
  const key = crypto.randomBytes(32).toString('hex');
  let recordedEvent;
  process.env.FACE_TEMPLATE_ENCRYPTION_KEY = key;
  const embedding = Array(128).fill(0);
  embedding[0] = 1;
  const encrypted = encryptEmbedding(embedding);
  process.env.FACE_SERVICE_TOKEN = '';
  process.env.FACE_TEMPLATE_ENCRYPTION_KEY = key;
  process.env.FACE_MATCH_THRESHOLD = '0.363';

  context.after(() => {
    User.findById = originalFindById;
    FaceEnrollment.findOne = originalFindOne;
    FaceVerificationEvent.create = originalCreate;
    process.env.FACE_SERVICE_TOKEN = originalToken;
    process.env.FACE_TEMPLATE_ENCRYPTION_KEY = originalEncryptionKey;
    process.env.FACE_MATCH_THRESHOLD = originalThreshold;
  });

  User.findById = () => ({
    select: async () => ({ _id: userId, role: 'student', isVerified: true })
  });
  FaceEnrollment.findOne = () => ({
    select: async () => ({
      ...encrypted,
      modelVersion: 'yunet-2023mar+sface-2021dec-opencv-4.11'
    })
  });
  FaceVerificationEvent.create = async (event) => {
    recordedEvent = event;
    return {};
  };

  const token = jwt.sign({ id: userId }, secret);
  const form = new FormData();
  form.append('capture', new Blob([Buffer.from('jpeg-placeholder')], { type: 'image/jpeg' }), 'capture.jpg');
  form.append('consent', 'true');
  const response = await fetch(`${baseUrl}/api/face-verification/verify`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });
  const result = await response.json();

  assert.equal(response.status, 503);
  assert.equal(result.identityStatus, 'inconclusive');
  assert.equal(result.livenessStatus, 'inconclusive');
  assert.equal(result.verificationStatus, 'pending_review');
  assert.equal(result.reasonCode, 'MODEL_SERVICE_UNAVAILABLE');
  assert.equal(recordedEvent.verificationStatus, 'pending_review');
});

test('face image uploads larger than 2 MiB are rejected', async () => {
  const token = jwt.sign({ id: userId }, secret);
  const form = new FormData();
  form.append(
    'capture',
    new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' }),
    'large.jpg'
  );
  const response = await fetch(`${baseUrl}/api/face-verification/preview`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form
  });

  assert.equal(response.status, 413);
  assert.equal((await response.json()).reasonCode, 'IMAGE_TOO_LARGE');
});
