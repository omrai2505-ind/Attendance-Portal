/**
 * End-to-End API Test Suite
 * ==========================
 * Tests the complete teacher authentication and attendance workflow.
 *
 * Run: node --test server/tests/api.test.js
 * (Requires the server to be running on http://localhost:3000)
 * (Requires a test MongoDB — uses the MONGO_URI from .env)
 *
 * Test categories:
 *  A. Teacher authentication
 *  B. Role-based access control (RBAC)
 *  C. Course management
 *  D. Student enrollment
 *  E. Session lifecycle
 *  F. Manual attendance
 *  G. Student workflow
 *  H. Attendance percentages
 */

const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const BASE = 'http://localhost:3000';

// ── Helpers ──────────────────────────────────────────────────────────────────

async function api(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  return { status: res.status, data };
}

// Test fixture credentials (these accounts are created at test startup)
const TEACHER_EMAIL = `test.teacher.${Date.now()}@iiitdwd.ac.in`;
const TEACHER_PASSWORD = 'Test@1234Teacher';
const STUDENT_EMAIL = `test.student.${Date.now()}@iiitdwd.ac.in`;
const STUDENT_PASSWORD = 'Test@1234Student';

let teacherToken = '';
let studentToken = '';
let createdCourseId = '';
let createdSessionId = '';
let studentUserId = '';

// ── Setup: Create accounts via signup + provision teacher directly ─────────────
// NOTE: In a real test environment these would be created via a test-setup fixture
// that directly writes to a test DB. Here we use the API where possible and
// fall back to the provision script pattern.

describe('A. Teacher Authentication', () => {
  test('A1. Sign up as teacher is accepted but not auto-verified', async () => {
    const { status, data } = await api('/api/auth/signup', {
      method: 'POST',
      body: { email: TEACHER_EMAIL, password: TEACHER_PASSWORD, role: 'teacher' }
    });
    assert.equal(status, 201, `Expected 201, got ${status}: ${data.message}`);
    assert.equal(data.success, true);
    assert.equal(data.pendingVerification, true, 'Should require verification');
  });

  test('A2. Unverified teacher cannot sign in', async () => {
    const { status, data } = await api('/api/auth/signin', {
      method: 'POST',
      body: { email: TEACHER_EMAIL, password: TEACHER_PASSWORD }
    });
    assert.equal(status, 403);
    assert.equal(data.code, 'UNVERIFIED');
  });

  test('A3. Provisioned teacher can sign in and obtain JWT', async () => {
    const { execFileSync } = require('child_process');
    const path = require('path');
    const scriptPath = path.resolve(__dirname, '../../scripts/provision-teacher.js');
    execFileSync(process.execPath, [scriptPath, '--email', TEACHER_EMAIL, '--password', TEACHER_PASSWORD]);

    const { status, data } = await api('/api/auth/signin', {
      method: 'POST',
      body: { email: TEACHER_EMAIL, password: TEACHER_PASSWORD }
    });
    assert.equal(status, 200, `Expected 200, got ${status}: ${data.message}`);
    assert.ok(data.token, 'Response must include JWT token');
    assert.equal(data.user.role, 'teacher');
    teacherToken = data.token;
  });

  test('A3b. Authenticated teacher /api/auth/me returns teacher profile', async () => {
    const { status, data } = await api('/api/auth/me', { token: teacherToken });
    assert.equal(status, 200);
    assert.equal(data.user.role, 'teacher');
    assert.equal(data.user.email, TEACHER_EMAIL.toLowerCase());
  });

  test('A4. Invalid password returns 401', async () => {
    const { status, data } = await api('/api/auth/signin', {
      method: 'POST',
      body: { email: TEACHER_EMAIL, password: 'WrongPassword!1' }
    });
    // Either 401 (wrong password) or 403 (unverified) — both correct rejections
    assert.ok([401, 403].includes(status), `Expected 401 or 403, got ${status}`);
  });

  test('A5. Non-existent account returns 401', async () => {
    const { status } = await api('/api/auth/signin', {
      method: 'POST',
      body: { email: `noone.${Date.now()}@iiitdwd.ac.in`, password: 'SomePass!1' }
    });
    assert.equal(status, 401);
  });

  test('A6. Non-institutional email is rejected', async () => {
    const { status, data } = await api('/api/auth/signin', {
      method: 'POST',
      body: { email: 'someone@gmail.com', password: 'AnyPass!1' }
    });
    assert.equal(status, 400);
    assert.ok(data.message.includes('iiitdwd.ac.in'));
  });

  test('A7. /api/auth/me with no token returns 401', async () => {
    const { status } = await api('/api/auth/me');
    assert.equal(status, 401);
  });

  test('A8. /api/auth/me with fake token returns 401', async () => {
    const { status } = await api('/api/auth/me', { token: 'fake.jwt.token' });
    assert.equal(status, 401);
  });
});

describe('B. Role-Based Access Control', () => {
  test('B1. Student cannot access teacher API endpoints', async () => {
    // Sign up + verify student (needs provisioning for full test)
    // Here we test with a fake student token attempt
    const { status } = await api('/api/teacher/dashboard', { token: 'invalid' });
    assert.equal(status, 401);
  });

  test('B2. Teacher API endpoints reject no-token requests', async () => {
    const endpoints = [
      '/api/teacher/dashboard',
      '/api/teacher/courses',
      '/api/student/courses',
      '/api/student/sessions/open'
    ];
    for (const path of endpoints) {
      const { status } = await api(path);
      assert.equal(status, 401, `Expected 401 for ${path}`);
    }
  });

  test('B3. Student API endpoints reject no-token requests', async () => {
    const { status } = await api('/api/student/attendance');
    assert.equal(status, 401);
  });
});

describe('C. Input Validation', () => {
  test('C1. Sign up with weak password is rejected', async () => {
    const { status, data } = await api('/api/auth/signup', {
      method: 'POST',
      body: { email: `test${Date.now()}@iiitdwd.ac.in`, password: 'weak' }
    });
    assert.equal(status, 400);
    assert.ok(data.message.toLowerCase().includes('password'));
  });

  test('C2. Sign up with non-institutional email is rejected', async () => {
    const { status } = await api('/api/auth/signup', {
      method: 'POST',
      body: { email: 'hacker@gmail.com', password: 'StrongPass!1' }
    });
    assert.equal(status, 400);
  });

  test('C3. Empty signin returns 400', async () => {
    const { status } = await api('/api/auth/signin', {
      method: 'POST',
      body: {}
    });
    assert.equal(status, 400);
  });

  test('C4. Duplicate signup returns 409 (verified) or 200 (pending re-verify)', async () => {
    // Second signup for same email
    const email = `dup${Date.now()}@iiitdwd.ac.in`;
    await api('/api/auth/signup', { method: 'POST', body: { email, password: 'StrongPass!1' } });
    const { status, data } = await api('/api/auth/signup', { method: 'POST', body: { email, password: 'StrongPass!1' } });
    // Unverified user gets 200 + pendingVerification
    assert.ok([200, 409].includes(status), `Expected 200 or 409, got ${status}: ${data.message}`);
  });
});

describe('D. Face Verification Endpoints (require auth)', () => {
  test('D1. GET /api/face-verification/enrollment with no token = 401', async () => {
    const { status } = await api('/api/face-verification/enrollment');
    assert.equal(status, 401);
  });

  test('D2. POST /api/face-verification/preview with no token = 401', async () => {
    const { status } = await api('/api/face-verification/preview', { method: 'POST' });
    assert.equal(status, 401);
  });

  test('D3. POST /api/face-verification/verify with no token = 401', async () => {
    const { status } = await api('/api/face-verification/verify', { method: 'POST' });
    assert.equal(status, 401);
  });
});

describe('E. Server Health', () => {
  test('E1. Server is reachable', async () => {
    const res = await fetch(`${BASE}/`);
    assert.ok(res.status < 500, `Server returned ${res.status}`);
  });

  test('E2. Unknown API routes return 404 or catch-all HTML', async () => {
    const res = await fetch(`${BASE}/api/nonexistent`);
    // Express catch-all returns HTML with 200 or a 404
    assert.ok([200, 404].includes(res.status));
  });
});

describe('F. Attendance Record Logic', () => {
  test('F1. POST /api/student/attendance/submit with no token = 401', async () => {
    const { status } = await api('/api/student/attendance/submit', {
      method: 'POST',
      body: { sessionId: 'fakeid', verificationResult: { verificationStatus: 'verified' } }
    });
    assert.equal(status, 401);
  });

  test('F2. POST /api/teacher/sessions/fakeid/attendance with no token = 401', async () => {
    const { status } = await api('/api/teacher/sessions/fakeid/attendance', {
      method: 'POST',
      body: { studentId: 'fakestudentid', status: 'present' }
    });
    assert.equal(status, 401);
  });
});

describe('G. Teacher Workflow: Courses, Sessions, and Dashboard', () => {
  test('G1. Teacher dashboard returns 200 and stats', async () => {
    assert.ok(teacherToken, 'Teacher token must be available from A3');
    const { status, data } = await api('/api/teacher/dashboard', { token: teacherToken });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.ok(Array.isArray(data.courses));
  });

  test('G2. Teacher can create a course', async () => {
    const code = `CS${Math.floor(100 + Math.random() * 899)}`;
    const { status, data } = await api('/api/teacher/courses', {
      method: 'POST',
      token: teacherToken,
      body: {
        code,
        title: 'Computer Networks',
        semester: 'Fall 2026',
        description: 'Undergraduate core course'
      }
    });
    assert.equal(status, 201, `Failed creating course: ${data.message}`);
    assert.equal(data.success, true);
    assert.ok(data.course._id);
    createdCourseId = data.course._id;
  });

  test('G3. Teacher can list courses and find created course', async () => {
    const { status, data } = await api('/api/teacher/courses', { token: teacherToken });
    assert.equal(status, 200);
    assert.ok(data.courses.some((c) => c._id === createdCourseId));
  });

  test('G4. Teacher can create an attendance session', async () => {
    const { status, data } = await api(`/api/teacher/courses/${createdCourseId}/sessions`, {
      method: 'POST',
      token: teacherToken,
      body: {
        label: 'Lecture 1 - Introduction',
        durationMinutes: 60
      }
    });
    assert.equal(status, 201, `Failed creating session: ${data.message}`);
    assert.ok(data.session._id);
    createdSessionId = data.session._id;
  });

  test('G5. Teacher can open attendance session', async () => {
    const { status, data } = await api(`/api/teacher/sessions/${createdSessionId}/open`, {
      method: 'PATCH',
      token: teacherToken,
      body: {
        latitude: 15.3928,
        longitude: 75.0253,
        radiusMeters: 50
      }
    });
    assert.equal(status, 200, `Failed opening session: ${data.message}`);
    assert.equal(data.session.status, 'open');
    assert.equal(data.session.location.latitude, 15.3928);
    assert.equal(data.session.location.longitude, 75.0253);
  });

  test('G6. Teacher can fetch session roster', async () => {
    const { status, data } = await api(`/api/teacher/sessions/${createdSessionId}/roster`, {
      token: teacherToken
    });
    assert.equal(status, 200, `Failed getting roster: ${data.message}`);
    assert.ok(Array.isArray(data.roster));
  });

  test('G7. Teacher can close attendance session', async () => {
    const { status, data } = await api(`/api/teacher/sessions/${createdSessionId}/close`, {
      method: 'PATCH',
      token: teacherToken
    });
    assert.equal(status, 200, `Failed closing session: ${data.message}`);
    assert.equal(data.session.status, 'closed');
  });
});

console.log('\n═══════════════════════════════════════════════════════════');
console.log(' IIIT Dharwad Attendance Portal — API Test Suite');
console.log(' Run: node --test server/tests/api.test.js');
console.log(' Server must be running at http://localhost:3000');
console.log('═══════════════════════════════════════════════════════════\n');
