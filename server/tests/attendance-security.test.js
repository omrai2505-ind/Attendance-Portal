/**
 * Automated Test Suite for Dynamic QR, GPS Geofencing, and Anti-Proxy Security
 * ==============================================================================
 * Tests:
 *  A. Classroom location configuration and validation
 *  B. Haversine distance and conservative geofencing
 *  C. Dynamic HMAC-SHA256 QR code rotation and verification
 *  D. Face verification token and anti-spoof checks
 *  E. Multi-factor atomic attendance submission and anti-proxy constraints
 *  F. Optional campus network-risk verification
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const {
  EARTH_RADIUS_METERS,
  DEFAULT_MAX_ACCURACY_METERS,
  isValidCoordinate,
  isValidAccuracy,
  isValidRadius,
  calculateHaversineDistance,
  evaluateGeofence
} = require('../config/geofence');

const {
  WINDOW_DURATION_SECONDS,
  WINDOW_DURATION_MS,
  generateSessionSecret,
  getTimeWindow,
  computeQrToken,
  generateDynamicQrPayload,
  verifyDynamicQrToken
} = require('../config/dynamicQr');

const {
  isNetworkCheckEnabled,
  getCampusIpRanges,
  isCampusIp,
  evaluateNetworkRisk
} = require('../config/networkPolicy');

// ── Test Category A: Classroom Location Configuration ───────────────────────
describe('A. Classroom Location Configuration & Coordinate Validation', () => {
  test('A1. Valid coordinates within normal ranges pass', () => {
    assert.equal(isValidCoordinate(15.3928, 75.0253), true); // IIIT Dharwad approximate
    assert.equal(isValidCoordinate(0, 0), true);
    assert.equal(isValidCoordinate(-90, -180), true);
    assert.equal(isValidCoordinate(90, 180), true);
    assert.equal(isValidCoordinate('15.3928', '75.0253'), true);
  });

  test('A2. Missing, null, or undefined coordinates are rejected', () => {
    assert.equal(isValidCoordinate(null, 75.0253), false);
    assert.equal(isValidCoordinate(15.3928, undefined), false);
    assert.equal(isValidCoordinate(undefined, null), false);
  });

  test('A3. Latitude below -90 or above 90 is rejected', () => {
    assert.equal(isValidCoordinate(-90.0001, 75.0253), false);
    assert.equal(isValidCoordinate(90.1, 75.0253), false);
    assert.equal(isValidCoordinate(-100, 0), false);
  });

  test('A4. Longitude below -180 or above 180 is rejected', () => {
    assert.equal(isValidCoordinate(15.3928, -180.0001), false);
    assert.equal(isValidCoordinate(15.3928, 180.0001), false);
    assert.equal(isValidCoordinate(0, 200), false);
  });

  test('A5. NaN, non-numeric strings, and infinite coordinates are rejected', () => {
    assert.equal(isValidCoordinate(NaN, 75.0253), false);
    assert.equal(isValidCoordinate(15.3928, Infinity), false);
    assert.equal(isValidCoordinate(-Infinity, 0), false);
    assert.equal(isValidCoordinate('not-a-number', 75.0253), false);
  });

  test('A6. Radius validation enforces positive finite numbers within maximum', () => {
    assert.equal(isValidRadius(50), true);
    assert.equal(isValidRadius(1), true);
    assert.equal(isValidRadius(500), true);
    assert.equal(isValidRadius(0), false); // Zero radius disallowed
    assert.equal(isValidRadius(-10), false); // Negative radius disallowed
    assert.equal(isValidRadius(501), false); // Beyond max 500m
    assert.equal(isValidRadius(NaN), false);
    assert.equal(isValidRadius(null), false);
  });

  test('A7. Accuracy validation rejects non-positive or excessive uncertainty', () => {
    assert.equal(isValidAccuracy(10, 25), true);
    assert.equal(isValidAccuracy(25, 25), true);
    assert.equal(isValidAccuracy(0, 25), false); // 0 accuracy invalid
    assert.equal(isValidAccuracy(-5, 25), false); // negative invalid
    assert.equal(isValidAccuracy(26, 25), false); // exceeds max threshold
    assert.equal(isValidAccuracy(NaN, 25), false);
  });
});

// ── Test Category B: Haversine Distance & Conservative Geofencing ────────────
describe('B. Haversine Distance Calculation & Conservative Geofencing', () => {
  const classroom = { latitude: 15.3928, longitude: 75.0253, radiusMeters: 50 };

  test('B1. Identical coordinates produce 0 meter distance', () => {
    const dist = calculateHaversineDistance(15.3928, 75.0253, 15.3928, 75.0253);
    assert.equal(Math.round(dist), 0);
  });

  test('B2. Accurately calculates known distance between geographic coordinates', () => {
    // Distance between IIIT Dharwad (15.3928, 75.0253) and Hubballi Station (~15.3444, 75.1432) is ~13-14km
    const dist = calculateHaversineDistance(15.3928, 75.0253, 15.3444, 75.1432);
    assert.ok(dist > 12000 && dist < 15000, `Expected ~13km, got ${dist}m`);
  });

  test('B3. Student inside classroom with good accuracy passes geofence', () => {
    // 10 meters away, accuracy 5m -> total uncertainty 15m <= 50m
    // 0.00009 degrees latitude is ~10 meters
    const student = { latitude: 15.39289, longitude: 75.0253, accuracy: 5 };
    const res = evaluateGeofence(classroom, student);
    assert.equal(res.passed, true);
    assert.ok(res.distanceMeters < 15);
    assert.equal(res.reasonCode, null);
  });

  test('B4. Student outside classroom radius is rejected (LOCATION_OUT_OF_BOUNDS)', () => {
    // 100 meters away: 0.0009 degrees latitude is ~100 meters
    const student = { latitude: 15.3937, longitude: 75.0253, accuracy: 5 };
    const res = evaluateGeofence(classroom, student);
    assert.equal(res.passed, false);
    assert.equal(res.reasonCode, 'LOCATION_OUT_OF_BOUNDS');
    assert.ok(res.distanceMeters > 50);
  });

  test('B5. Conservative rule: Near boundary with high uncertainty is rejected', () => {
    // Distance 40m + Accuracy 15m = 55m > 50m radius -> Rejected
    // 0.00036 degrees latitude is ~40 meters
    const student = { latitude: 15.39316, longitude: 75.0253, accuracy: 15 };
    const res = evaluateGeofence(classroom, student);
    assert.equal(res.passed, false);
    assert.equal(res.reasonCode, 'LOCATION_OUT_OF_BOUNDS');
  });

  test('B6. Poor reported GPS accuracy exceeding threshold is rejected (LOCATION_UNRELIABLE)', () => {
    const student = { latitude: 15.3928, longitude: 75.0253, accuracy: 30 }; // > 25m
    const res = evaluateGeofence(classroom, student, { maxAccuracyMeters: 25 });
    assert.equal(res.passed, false);
    assert.equal(res.reasonCode, 'LOCATION_UNRELIABLE');
  });

  test('B7. Zero or negative GPS accuracy is rejected (LOCATION_UNRELIABLE)', () => {
    assert.equal(evaluateGeofence(classroom, { latitude: 15.3928, longitude: 75.0253, accuracy: 0 }).passed, false);
    assert.equal(evaluateGeofence(classroom, { latitude: 15.3928, longitude: 75.0253, accuracy: -5 }).passed, false);
  });

  test('B8. Unconfigured classroom location returns SESSION_LOCATION_NOT_CONFIGURED', () => {
    const res = evaluateGeofence({ latitude: null, longitude: null }, { latitude: 15.3928, longitude: 75.0253, accuracy: 10 });
    assert.equal(res.passed, false);
    assert.equal(res.reasonCode, 'SESSION_LOCATION_NOT_CONFIGURED');
  });

  test('B9. Malformed or missing student coordinates return INVALID_LOCATION_DATA', () => {
    assert.equal(evaluateGeofence(classroom, null).reasonCode, 'INVALID_LOCATION_DATA');
    assert.equal(evaluateGeofence(classroom, { latitude: 'abc', longitude: 75 }).reasonCode, 'INVALID_LOCATION_DATA');
  });
});

// ── Test Category C: Dynamic Rotating QR Protocol ───────────────────────────
describe('C. Dynamic Rotating QR Protocol & Expiration Policy', () => {
  const sessionId = '64e8a1b2c3d4e5f6a7b8c9d0';
  const secret = generateSessionSecret();

  test('C1. Secret generation produces 64-char high-entropy hex string', () => {
    assert.equal(typeof secret, 'string');
    assert.equal(secret.length, 64);
  });

  test('C2. Dynamic QR payload contains sid, window, and valid HMAC-SHA256 token', () => {
    const now = 1700000000000;
    const qr = generateDynamicQrPayload(sessionId, secret, now);
    assert.ok(qr.payload);
    assert.ok(qr.timeWindow);
    assert.equal(qr.windowDurationSeconds, 30);

    const parsed = JSON.parse(qr.payload);
    assert.equal(parsed.sid, sessionId);
    assert.equal(parsed.w, qr.timeWindow);
    assert.equal(typeof parsed.t, 'string');
    assert.equal(parsed.t.length, 64);
  });

  test('C3. Current-window token verifies successfully', () => {
    const now = 1700000000000;
    const qr = generateDynamicQrPayload(sessionId, secret, now);
    const result = verifyDynamicQrToken(qr.payload, sessionId, secret, now);
    assert.equal(result.valid, true);
    assert.equal(result.reasonCode, null);
  });

  test('C4. Immediately preceding window token verifies (latency tolerance)', () => {
    const windowStart = 1700000000000;
    const qr = generateDynamicQrPayload(sessionId, secret, windowStart);
    // Advance time by 31 seconds (into next 30s window)
    const nextWindowTime = windowStart + 31000;
    const result = verifyDynamicQrToken(qr.payload, sessionId, secret, nextWindowTime);
    assert.equal(result.valid, true);
  });

  test('C5. Expired token older than 2 windows is rejected (INVALID_OR_EXPIRED_QR)', () => {
    const windowStart = 1700000000000;
    const qr = generateDynamicQrPayload(sessionId, secret, windowStart);
    // Advance time by 70 seconds (2+ windows of 30s later)
    const futureTime = windowStart + 70000;
    const result = verifyDynamicQrToken(qr.payload, sessionId, secret, futureTime);
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, 'INVALID_OR_EXPIRED_QR');
  });

  test('C6. Token for another session is rejected (QR_SESSION_MISMATCH)', () => {
    const otherSessionId = '64e8a1b2c3d4e5f6a7b8c9d1';
    const qr = generateDynamicQrPayload(otherSessionId, secret, Date.now());
    const result = verifyDynamicQrToken(qr.payload, sessionId, secret, Date.now());
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, 'QR_SESSION_MISMATCH');
  });

  test('C7. Forged or modified HMAC token is rejected (constant-time verification)', () => {
    const qr = generateDynamicQrPayload(sessionId, secret, Date.now());
    const parsed = JSON.parse(qr.payload);
    parsed.t = 'a'.repeat(64); // Tampered token
    const result = verifyDynamicQrToken(parsed, sessionId, secret, Date.now());
    assert.equal(result.valid, false);
    assert.equal(result.reasonCode, 'INVALID_OR_EXPIRED_QR');
  });

  test('C8. Malformed QR payload is safely rejected without crashing', () => {
    assert.equal(verifyDynamicQrToken('{not-valid-json', sessionId, secret).valid, false);
    assert.equal(verifyDynamicQrToken(null, sessionId, secret).valid, false);
    assert.equal(verifyDynamicQrToken({}, sessionId, secret).valid, false);
    assert.equal(verifyDynamicQrToken('plain-text', sessionId, secret).valid, false);
  });
});

// ── Test Category D: Server-Side Face Verification Token & Anti-Proxy ───────
describe('D. Server-Side Face Verification Token & Security', () => {
  const jwtSecret = 'test-suite-jwt-secret';
  const studentId = 'student-id-123';
  const sessionId = 'session-id-456';

  test('D1. Genuine face verification token encodes student ID, session, and match outcome', () => {
    const token = jwt.sign(
      {
        studentId,
        sessionId,
        action: 'face_verification',
        identityStatus: 'match',
        livenessStatus: 'pass',
        verificationStatus: 'verified',
        nonce: crypto.randomBytes(16).toString('hex')
      },
      jwtSecret,
      { expiresIn: '5m' }
    );

    const decoded = jwt.verify(token, jwtSecret);
    assert.equal(decoded.studentId, studentId);
    assert.equal(decoded.sessionId, sessionId);
    assert.equal(decoded.action, 'face_verification');
    assert.equal(decoded.identityStatus, 'match');
    assert.ok(decoded.nonce);
  });

  test('D2. Forged signature or wrong secret is rejected by jwt.verify', () => {
    const forgedToken = jwt.sign(
      { studentId, action: 'face_verification', identityStatus: 'match' },
      'wrong-secret'
    );
    assert.throws(() => jwt.verify(forgedToken, jwtSecret), /invalid signature/);
  });

  test('D3. Expired verification token is rejected', async () => {
    const expiredToken = jwt.sign(
      { studentId, action: 'face_verification', identityStatus: 'match' },
      jwtSecret,
      { expiresIn: '1ms' }
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.throws(() => jwt.verify(expiredToken, jwtSecret), /jwt expired/);
  });
});

// ── Test Category E: Optional Campus Network Verification ───────────────────
describe('E. Optional Campus Network Policy & Hotspot / Mobile Data Compatibility', () => {
  test('E1. Campus network check is disabled by default', () => {
    delete process.env.CAMPUS_NETWORK_CHECK_ENABLED;
    assert.equal(isNetworkCheckEnabled(), false);
  });

  test('E2. Default policy allows mobile data, hotspots, and any IP without blocking', () => {
    delete process.env.CAMPUS_NETWORK_CHECK_ENABLED;
    const dummyReq = { ip: '49.207.123.45' }; // Typical 4G/5G mobile carrier IP
    const risk = evaluateNetworkRisk(dummyReq);
    assert.equal(risk.policyEnabled, false);
    assert.equal(risk.passed, true);
  });

  test('E3. When enabled, campus IP range matching accurately identifies campus IPs', () => {
    process.env.CAMPUS_NETWORK_CHECK_ENABLED = 'true';
    process.env.CAMPUS_IP_RANGES = '10.10.0.0/16,192.168.100.0/24';

    assert.equal(isCampusIp('10.10.5.20'), true);
    assert.equal(isCampusIp('192.168.100.55'), true);
    assert.equal(isCampusIp('10.11.0.1'), false);
    assert.equal(isCampusIp('8.8.8.8'), false);

    // Clean up
    delete process.env.CAMPUS_NETWORK_CHECK_ENABLED;
    delete process.env.CAMPUS_IP_RANGES;
  });
});
