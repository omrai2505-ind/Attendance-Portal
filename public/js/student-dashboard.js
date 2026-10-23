// ═══════════════════════════════════════════════════════════════════════════
// IIIT Dharwad — Student Dashboard Logic
// ═══════════════════════════════════════════════════════════════════════════

// ── Token / OAuth callback handling ───────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
  localStorage.setItem('token', urlToken);
  localStorage.setItem('role', 'student'); // Google OAuth lands here for students
  window.history.replaceState({}, document.title, '/student-dashboard.html');
}

const token = localStorage.getItem('token');
const role = localStorage.getItem('role');

// Guard: redirect non-students and unauthenticated users
if (!token) {
  window.location.replace('/signin.html');
} else if (role === 'teacher') {
  window.location.replace('/teacher-dashboard.html');
} else {
  initDashboard();
}

// ── State ─────────────────────────────────────────────────────────────────
let currentUser = null;
let activeFvSession = null; // session object currently being verified
let isFaceEnrolled = false;

// ── Auth helper ───────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status, data });
  return data;
}

// ── Init ──────────────────────────────────────────────────────────────────
async function initDashboard() {
  try {
    // Load user info (also validates token)
    const meData = await apiFetch('/api/auth/me');
    currentUser = meData.user;

    // Guard against teacher tokens arriving here
    if (currentUser.role !== 'student') {
      window.location.replace('/teacher-dashboard.html');
      return;
    }

    localStorage.setItem('role', 'student');
    document.getElementById('usernameDisplay').textContent =
      currentUser.username || currentUser.email.split('@')[0];

    // Show dashboard
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('dashContent').classList.remove('hidden');

    // Load data in parallel
    await Promise.all([loadCourses(), loadOpenSessions()]);

    // Check mandatory Face ID registration (auto-prompts if first-time/not registered)
    await checkFaceEnrollment(true);
  } catch (err) {
    console.error('Dashboard init failed:', err);
    if (err.status === 401 || err.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      window.location.replace('/signin.html');
    } else {
      document.getElementById('loadingState').style.display = 'none';
      document.getElementById('authError').classList.remove('hidden');
    }
  }
}

// ── Courses ───────────────────────────────────────────────────────────────
let coursesData = [];

async function loadCourses() {
  try {
    const data = await apiFetch('/api/student/courses');
    coursesData = data.courses || [];
    renderCourseMetrics();
    renderCoursesTable();
  } catch (err) {
    showAlert('Could not load your courses: ' + (err.data?.message || err.message));
    document.getElementById('coursesTableBody').innerHTML =
      '<tr><td colspan="5" class="px-6 py-8 text-center text-red-500 italic">Failed to load courses.</td></tr>';
  }
}

function renderCourseMetrics() {
  const totalSessions = coursesData.reduce((s, c) => s + (c.totalSessions || 0), 0);
  const totalPresent = coursesData.reduce((s, c) => s + (c.attended || 0), 0);
  const pct = totalSessions > 0 ? ((totalPresent / totalSessions) * 100) : null;

  document.getElementById('metricCourses').textContent = coursesData.length;
  document.getElementById('metricAttended').textContent =
    totalSessions > 0 ? `${totalPresent} / ${totalSessions}` : '—';
  document.getElementById('metricSessionsLabel').textContent =
    totalSessions > 0 ? `of ${totalSessions} total sessions` : 'No sessions yet';

  if (pct !== null) {
    const pctStr = pct.toFixed(1) + '%';
    document.getElementById('metricOverall').textContent = pctStr;
    const bar = document.getElementById('metricBar');
    bar.style.width = pct + '%';
    bar.style.background = pct >= 75 ? '#22c55e' : pct >= 60 ? '#f59e0b' : '#ef4444';

    let statusText, statusColor;
    if (pct >= 75) { statusText = 'Above 75% — Safe'; statusColor = 'text-emerald-600'; }
    else if (pct >= 60) { statusText = 'Below 75% — At risk'; statusColor = 'text-amber-600'; }
    else { statusText = 'Below 60% — Critical'; statusColor = 'text-red-600'; }
    const el = document.getElementById('metricStatus');
    el.textContent = statusText;
    el.className = `text-xs font-semibold mt-2 ${statusColor}`;
  } else {
    document.getElementById('metricOverall').textContent = '—';
    document.getElementById('metricStatus').textContent = 'No sessions yet';
  }
}

function renderCoursesTable() {
  const tbody = document.getElementById('coursesTableBody');
  if (!coursesData.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="px-6 py-10 text-center text-slate-400 italic">You are not enrolled in any courses yet.</td></tr>';
    return;
  }

  tbody.innerHTML = coursesData.map((c) => {
    const pct = c.percentage;
    const pctStr = pct !== null ? pct.toFixed(1) + '%' : '—';
    const pctColor = pct === null ? 'text-slate-400' : pct >= 75 ? 'text-emerald-600 font-bold' : pct >= 60 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold';
    const badge = pct === null ? '<span class="px-2.5 py-1 bg-slate-100 text-slate-500 text-xs rounded-full font-semibold border border-slate-200">No data</span>'
      : pct >= 75 ? '<span class="px-2.5 py-1 bg-emerald-50 text-emerald-700 text-xs rounded-full font-semibold border border-emerald-100">Safe ✓</span>'
      : pct >= 60 ? '<span class="px-2.5 py-1 bg-amber-50 text-amber-700 text-xs rounded-full font-semibold border border-amber-100">At Risk ⚠</span>'
      : '<span class="px-2.5 py-1 bg-red-50 text-red-700 text-xs rounded-full font-semibold border border-red-100">Critical ✗</span>';
    const attended = c.totalSessions > 0 ? `${c.attended} / ${c.totalSessions}` : '—';
    const faculty = c.teacher ? (c.teacher.username || c.teacher.email) : '—';
    return `<tr class="course-row transition-colors">
      <td class="px-6 py-4 font-semibold text-slate-900">${escHtml(c.code)} — ${escHtml(c.title)}</td>
      <td class="px-6 py-4 text-slate-600">${escHtml(faculty)}</td>
      <td class="px-6 py-4">${attended}</td>
      <td class="px-6 py-4 ${pctColor}">${pctStr}</td>
      <td class="px-6 py-4">${badge}</td>
    </tr>`;
  }).join('');
}

// ── Open Sessions ──────────────────────────────────────────────────────────
let openSessions = [];

async function loadOpenSessions() {
  const container = document.getElementById('openSessionsList');
  try {
    const data = await apiFetch('/api/student/sessions/open');
    openSessions = data.sessions || [];
    document.getElementById('metricOpen').textContent = openSessions.length;

    if (!openSessions.length) {
      container.innerHTML = '<p class="text-sm text-slate-500 italic">No attendance sessions are currently open for your courses.</p>';
      return;
    }

    container.innerHTML = openSessions.map((s) => {
      const course = s.course || {};
      const alreadyDone = s.alreadySubmitted;
      const badgeHtml = alreadyDone
        ? `<span class="status-badge-${alreadyDone === 'present' ? 'present' : alreadyDone === 'absent' ? 'absent' : 'pending'}">
            ${alreadyDone === 'present' ? '✓ Present' : alreadyDone === 'absent' ? '✗ Absent' : '⏳ Pending Review'}
           </span>`
        : '';
      const actionHtml = alreadyDone
        ? `<p class="text-xs text-slate-500 mt-2">You already submitted for this session.</p>`
        : `<button onclick="openAttendanceWorkflow('${s._id}', '${escHtml(course.code || '')} — ${escHtml(course.title || '')}', '${escHtml(s.label || 'Session')}')"
             class="mt-3 btn-submit text-sm px-4 py-2 rounded-xl inline-flex items-center gap-1.5 shadow-sm">
             <span>🎯</span> Mark Attendance
           </button>`;
      return `<div class="open-session-card">
        <div class="flex items-start justify-between gap-4">
          <div>
            <p class="text-xs font-bold uppercase tracking-wider text-blue-700">${escHtml(course.code || '')}</p>
            <p class="font-bold text-slate-900 text-sm mt-0.5">${escHtml(course.title || 'Course')}</p>
            <p class="text-xs text-slate-600 mt-1">${escHtml(s.label || 'Class session')}</p>
            <p class="text-xs text-slate-500 mt-0.5">Opened: ${new Date(s.openedAt).toLocaleString()}</p>
          </div>
          <div>${badgeHtml}</div>
        </div>
        ${actionHtml}
      </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<p class="text-sm text-red-500 italic">Could not load open sessions. ' + escHtml(err.message) + '</p>';
  }
}

// ── Face Verification & Enrollment Lifecycle ──────────────────────────────
async function checkFaceEnrollment(autoPrompt = false) {
  try {
    const res = await apiFetch('/api/face-verification/enrollment');
    isFaceEnrolled = Boolean(res.enrolled);
    updateFaceIdUI(isFaceEnrolled);

    if (!isFaceEnrolled && autoPrompt) {
      // First-time login without registered face template: prompt immediately!
      openFaceRegistration(true);
    }
  } catch (err) {
    console.warn('Could not check face enrollment state:', err);
  }
}

function updateFaceIdUI(enrolled) {
  const banner = document.getElementById('firstTimeFaceBanner');
  const btn = document.getElementById('openFaceIdBtn');

  if (enrolled) {
    if (banner) banner.classList.add('hidden');
    if (btn) {
      btn.innerHTML = '<span>👤 Face ID Active</span>';
      btn.className = 'inline-flex items-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all';
    }
  } else {
    if (banner) banner.classList.remove('hidden');
    if (btn) {
      btn.innerHTML = '<span class="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span><span>⚠️ Register Face ID</span>';
      btn.className = 'inline-flex items-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-900 border border-amber-300 px-3.5 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all shadow-sm';
    }
  }
}

function openFaceRegistration(isMandatory = false) {
  activeFvSession = null;
  document.getElementById('fvSessionTitle').textContent = isMandatory
    ? 'Mandatory Face ID Registration'
    : 'Face ID Enrollment & Check';
  document.getElementById('fvCourseLabel').textContent = isMandatory
    ? 'First-time setup: Capture your face template to prevent proxy attendance.'
    : 'Manage or test your facial recognition profile.';
  document.getElementById('faceVerificationSection').classList.remove('hidden');
  document.getElementById('faceVerificationSection').scrollIntoView({ behavior: 'smooth' });

  window.FaceVerification.mount(document.getElementById('faceVerification'), {
    getToken: () => token,
    onStatusChange: (info) => console.log('[FV status]', info),
    onEnrolled: async () => {
      isFaceEnrolled = true;
      updateFaceIdUI(true);
      showAlert('🎉 Face ID registered successfully! Your account is verified and ready for attendance.', 'success');
      await Promise.all([loadCourses(), loadOpenSessions()]);
      setTimeout(() => {
        window.FaceVerification.destroy();
        document.getElementById('faceVerificationSection').classList.add('hidden');
      }, 2500);
    }
  });
}

// ── Guided Multi-Factor Attendance Workflow ──────────────────────────────
let workflowSession = null;
let html5QrScannerInstance = null;
let currentScannedQrPayload = null;
let currentAcquiredGps = null;

function openAttendanceWorkflow(sessionId, courseLabel, sessionLabel) {
  // Guard: Must register Face ID first before marking attendance to prevent proxy
  if (!isFaceEnrolled) {
    showAlert('⚠️ Face ID registration required before marking attendance to prevent proxy.', 'error');
    openFaceRegistration(true);
    return;
  }

  workflowSession = { sessionId, courseLabel, sessionLabel };
  currentScannedQrPayload = null;
  currentAcquiredGps = null;
  hideWorkflowError();
  document.getElementById('wfSubmittingAlert')?.classList.add('hidden');
  document.getElementById('wfFinalResult')?.classList.add('hidden');

  document.getElementById('wfSessionTitle').textContent = sessionLabel || 'Attendance Verification';
  document.getElementById('wfCourseLabel').textContent = courseLabel || '';
  
  // Show workflow section and scroll to it
  document.getElementById('attendanceWorkflowSection').classList.remove('hidden');
  document.getElementById('attendanceWorkflowSection').scrollIntoView({ behavior: 'smooth' });

  // Reset steps
  setWorkflowStep(1);
}

function setWorkflowStep(step) {
  // Indicators
  for (let i = 1; i <= 3; i++) {
    const el = document.getElementById(`stepIndicator${i}`);
    const badge = el.querySelector('span:first-child');
    if (i === step) {
      el.className = 'p-2.5 rounded-xl border bg-blue-50 border-blue-500 text-blue-900 text-xs font-semibold flex items-center gap-2 shadow-sm';
      badge.className = 'w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px]';
    } else if (i < step) {
      el.className = 'p-2.5 rounded-xl border bg-emerald-50 border-emerald-300 text-emerald-800 text-xs font-semibold flex items-center gap-2';
      badge.className = 'w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px]';
      badge.textContent = '✓';
    } else {
      el.className = 'p-2.5 rounded-xl border bg-slate-50 border-slate-200 text-slate-500 text-xs font-semibold flex items-center gap-2';
      badge.className = 'w-5 h-5 rounded-full bg-slate-300 text-slate-700 flex items-center justify-center text-[10px]';
      badge.textContent = String(i);
    }
  }

  // Views
  document.getElementById('wfStep1').classList.toggle('hidden', step !== 1);
  document.getElementById('wfStep2').classList.toggle('hidden', step !== 2);
  document.getElementById('wfStep3').classList.toggle('hidden', step !== 3);
  document.getElementById('wfFinalResult').classList.add('hidden');
}

// ── Step 1: Dynamic QR Code Scanner ──────────────────────────────────────────
function getHtml5QrcodeClass() {
  if (typeof window.Html5Qrcode !== 'undefined') return window.Html5Qrcode;
  if (typeof window.__Html5QrcodeLibrary__ !== 'undefined' && window.__Html5QrcodeLibrary__.Html5Qrcode) {
    return window.__Html5QrcodeLibrary__.Html5Qrcode;
  }
  if (typeof Html5Qrcode !== 'undefined') return Html5Qrcode;
  return null;
}

async function startQrScanner() {
  const statusEl = document.getElementById('qrScannerStatus');
  const startBtn = document.getElementById('startScannerBtn');
  const stopBtn = document.getElementById('stopScannerBtn');

  const Html5QrcodeClass = getHtml5QrcodeClass();
  if (!Html5QrcodeClass) {
    statusEl.innerHTML = '<span class="text-red-500">QR scanner library not loaded. Please refresh the page.</span>';
    return;
  }

  try {
    statusEl.innerHTML = '<span class="text-blue-600 animate-pulse">Requesting camera access...</span>';
    startBtn.classList.add('hidden');
    stopBtn.classList.remove('hidden');

    html5QrScannerInstance = new Html5QrcodeClass('qrReader');
    const scanConfig = { fps: 10, qrbox: { width: 220, height: 220 } };
    const scanCallback = (decodedText) => handleQrScanned(decodedText);
    const scanErrorCallback = () => {};

    // Attempt back camera (environment) first for mobile devices; fall back to user/front camera (laptops/webcams)
    try {
      await html5QrScannerInstance.start({ facingMode: 'environment' }, scanConfig, scanCallback, scanErrorCallback);
    } catch (camErr) {
      console.warn('Environment camera not accessible, trying user-facing camera:', camErr);
      await html5QrScannerInstance.start({ facingMode: 'user' }, scanConfig, scanCallback, scanErrorCallback);
    }

    statusEl.innerHTML = '<span class="text-emerald-600">Camera active. Center the instructor\'s projected QR code in the box.</span>';
  } catch (err) {
    console.error('Camera QR start error:', err);
    statusEl.innerHTML = `<span class="text-red-500">Camera error: ${escHtml(err.message || String(err))}. You can also use "Upload QR Photo / File" above.</span>`;
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
  }
}

async function handleQrFileUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const Html5QrcodeClass = getHtml5QrcodeClass();
  const statusEl = document.getElementById('qrScannerStatus');
  if (!Html5QrcodeClass) {
    statusEl.innerHTML = '<span class="text-red-500">QR scanner library not loaded. Please refresh the page.</span>';
    return;
  }

  statusEl.innerHTML = '<span class="text-blue-600 animate-pulse">Reading QR code from image...</span>';
  try {
    const scanner = new Html5QrcodeClass('qrReader');
    const decodedText = await scanner.scanFile(file, true);
    scanner.clear();
    handleQrScanned(decodedText);
  } catch (err) {
    statusEl.innerHTML = `<span class="text-red-500">No readable QR code found in the uploaded image. Please retry with a clearer photo.</span>`;
  } finally {
    event.target.value = '';
  }
}

async function stopQrScanner() {
  if (html5QrScannerInstance) {
    try {
      await html5QrScannerInstance.stop();
      html5QrScannerInstance.clear();
    } catch (e) {
      console.warn('QR stop warning:', e);
    }
    html5QrScannerInstance = null;
  }
  document.getElementById('startScannerBtn')?.classList.remove('hidden');
  document.getElementById('stopScannerBtn')?.classList.add('hidden');
  document.getElementById('qrScannerStatus').textContent = 'Scanner stopped.';
}

let isVerifyingQr = false;

async function handleQrScanned(decodedText) {
  if (isVerifyingQr) return;
  const statusEl = document.getElementById('qrScannerStatus');

  // 1. Client-side format sanity check
  let parsed;
  try {
    parsed = JSON.parse(decodedText);
    if (!parsed.sid || parsed.w === undefined || !parsed.t) {
      statusEl.innerHTML = '<span class="text-red-500 font-semibold">❌ Invalid QR format. Please scan the official classroom QR code.</span>';
      return;
    }
  } catch (err) {
    statusEl.innerHTML = '<span class="text-red-500 font-semibold">❌ Scanned code is not a valid classroom attendance token.</span>';
    return;
  }

  if (workflowSession && parsed.sid !== workflowSession.sessionId) {
    statusEl.innerHTML = '<span class="text-red-500 font-semibold">❌ This QR code belongs to a different class session!</span>';
    return;
  }

  // 2. Real-time server-side verification: check if this dynamic QR token is active & unexpired!
  isVerifyingQr = true;
  statusEl.innerHTML = '<span class="text-blue-600 font-semibold animate-pulse">⟳ Verifying QR token validity with server...</span>';

  try {
    const verifyRes = await apiFetch(`/api/student/sessions/${workflowSession.sessionId}/verify-qr`, {
      method: 'POST',
      body: JSON.stringify({ qrPayload: decodedText })
    });

    if (verifyRes.valid) {
      currentScannedQrPayload = decodedText;
      statusEl.innerHTML = '<span class="text-emerald-600 font-bold">✅ Active QR Code Verified by Server! Advancing...</span>';
      stopQrScanner();
      showAlert('✓ QR Code verified by server!', 'success');

      // Move to Step 2 (GPS Location)
      setWorkflowStep(2);
      acquireFreshGps();
    } else {
      statusEl.innerHTML = `<span class="text-red-600 font-semibold">❌ QR Verification Rejected: ${escHtml(verifyRes.message || 'QR code expired or invalid')}</span>`;
    }
  } catch (err) {
    console.warn('Real-time QR verification error:', err);
    const msg = err.data?.message || err.message || 'QR code is expired or invalid.';
    statusEl.innerHTML = `<div class="p-2.5 bg-red-50 border border-red-200 rounded-xl text-red-700 font-semibold text-xs mt-1">
      ⚠️ ${escHtml(msg)}<br>
      <span class="font-normal text-slate-600 text-[11px]">The QR code rotates every 30 seconds. Point your camera at the instructor’s current screen.</span>
    </div>`;
  } finally {
    isVerifyingQr = false;
  }
}

// ── Step 2: Fresh GPS Acquisition ───────────────────────────────────────────
function acquireFreshGps() {
  const statusEl = document.getElementById('gpsStatusMessage');
  const acqStatus = document.getElementById('gpsAcquisitionStatus');
  const accDisplay = document.getElementById('gpsAccuracyDisplay');
  const coordsDisplay = document.getElementById('gpsCoordsDisplay');
  const btn = document.getElementById('acquireGpsBtn');

  if (!navigator.geolocation) {
    statusEl.innerHTML = '<span class="text-red-500">Geolocation is not supported by your browser.</span>';
    return;
  }

  btn.disabled = true;
  statusEl.innerHTML = '';
  acqStatus.innerHTML = '<span class="text-blue-600 animate-pulse">Requesting fresh GPS coordinates...</span>';

  // Strict high accuracy, no cache
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null;

      currentAcquiredGps = { latitude: lat, longitude: lon, accuracy: acc };
      acqStatus.innerHTML = '<span class="text-emerald-600 font-semibold">✓ Fresh GPS acquired</span>';
      accDisplay.textContent = acc !== null ? `±${acc} meters` : 'Unknown';
      coordsDisplay.textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

      if (acc !== null && acc > 35) {
        statusEl.innerHTML = `<span class="text-amber-600">Reported accuracy is ±${acc}m (low). If verification fails, retry near a window. Proceeding to face check...</span>`;
      } else {
        statusEl.innerHTML = '<span class="text-emerald-700">High-accuracy GPS lock confirmed. Moving to face verification...</span>';
      }

      // Move to Step 3 after brief pause
      setTimeout(() => {
        setWorkflowStep(3);
        mountWorkflowFaceVerification();
      }, 1000);
    },
    (err) => {
      btn.disabled = false;
      acqStatus.innerHTML = '<span class="text-red-600 font-semibold">✗ GPS failed</span>';
      statusEl.innerHTML = `<span class="text-red-500">Location error: ${err.message}. Please enable high-accuracy device location and click Retry.</span>`;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

// ── Step 3: Biometric Face Verification & Atomic Submission ──────────────────
// ── Step 3: Biometric Face Verification & Atomic Submission ──────────────────
function mountWorkflowFaceVerification() {
  const container = document.getElementById('wfFaceVerification');
  container.innerHTML = '';

  window.FaceVerification.mount(container, {
    sessionId: workflowSession ? workflowSession.sessionId : null,
    getToken: () => token,
    onStatusChange: (info) => console.log('[Workflow FV status]', info),
    onVerified: async (fvResult) => {
      await submitAttendanceFlow(fvResult);
    },
    onFailed: (fvResult) => {
      showWorkflowError('Face verification did not match your enrolled biometric profile. Please face the camera directly in good lighting and retry.');
    }
  });
}

function showWorkflowError(msg) {
  const el = document.getElementById('wfErrorAlert');
  if (el) {
    el.innerHTML = `<div class="flex items-start gap-2.5">
      <span class="text-base flex-shrink-0">⚠️</span>
      <div class="flex-1">${escHtml(msg)}</div>
    </div>`;
    el.classList.remove('hidden');
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function hideWorkflowError() {
  const el = document.getElementById('wfErrorAlert');
  if (el) el.classList.add('hidden');
}

async function submitAttendanceFlow(fvResult) {
  if (!workflowSession || !workflowSession.sessionId) return;
  hideWorkflowError();

  if (!currentScannedQrPayload) {
    showWorkflowError('Missing QR code. Please scan the instructor’s rotating QR code first.');
    setWorkflowStep(1);
    return;
  }
  if (!currentAcquiredGps) {
    showWorkflowError('Missing GPS location. Please acquire your location first.');
    setWorkflowStep(2);
    return;
  }

  const submittingEl = document.getElementById('wfSubmittingAlert');
  if (submittingEl) submittingEl.classList.remove('hidden');

  try {
    const res = await apiFetch('/api/student/attendance/submit', {
      method: 'POST',
      body: JSON.stringify({
        sessionId: workflowSession.sessionId,
        qrPayload: currentScannedQrPayload,
        location: currentAcquiredGps,
        verificationToken: fvResult.verificationToken || null,
        verificationResult: fvResult
      })
    });

    if (submittingEl) submittingEl.classList.add('hidden');

    // Destroy face camera cleanly
    window.FaceVerification.destroy();

    // Show completion UI
    document.getElementById('wfStep1').classList.add('hidden');
    document.getElementById('wfStep2').classList.add('hidden');
    document.getElementById('wfStep3').classList.add('hidden');
    const finalCard = document.getElementById('wfFinalResult');
    finalCard.classList.remove('hidden');

    const isPresent = res.attendanceStatus === 'present';
    document.getElementById('wfFinalIcon').textContent = isPresent ? '🎉' : '⏳';
    document.getElementById('wfFinalTitle').textContent = isPresent
      ? 'Attendance Verified & Recorded!'
      : 'Attendance Submitted for Review';
    document.getElementById('wfFinalMessage').textContent =
      res.message || 'All 3 factors (QR code, GPS geofence, and Biometric Face ID) were successfully verified on the server.';

    showAlert(res.message || 'Attendance confirmed as present!', 'success');
    await Promise.all([loadCourses(), loadOpenSessions()]);
  } catch (err) {
    if (submittingEl) submittingEl.classList.add('hidden');
    console.error('Attendance submission failed:', err);
    const code = err.data?.reasonCode;
    const msg = err.data?.message || err.message;

    if (code === 'INVALID_OR_EXPIRED_QR') {
      showWorkflowError('⚠️ The dynamic QR code expired while verifying. Please scan the current projected QR code to complete attendance.');
      setWorkflowStep(1);
    } else if (code === 'LOCATION_OUT_OF_BOUNDS') {
      showWorkflowError(`⚠️ Geofence: ${msg} Please ensure high-accuracy device location is active and you are inside the classroom.`);
      setWorkflowStep(2);
    } else if (code === 'LOCATION_UNRELIABLE') {
      showWorkflowError('⚠️ GPS Accuracy: Reported device location is too uncertain. Move near a window or re-acquire location.');
      setWorkflowStep(2);
    } else if (code === 'DUPLICATE_ATTENDANCE') {
      showAlert('You have already submitted attendance for this class session.', 'info');
      closeAttendanceWorkflow();
    } else {
      showWorkflowError(`Attendance could not be recorded: ${msg}`);
    }
  }
}

function closeAttendanceWorkflow() {
  stopQrScanner();
  window.FaceVerification.destroy();
  document.getElementById('attendanceWorkflowSection').classList.add('hidden');
  workflowSession = null;
  currentScannedQrPayload = null;
  currentAcquiredGps = null;
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('openFaceIdBtn')?.addEventListener('click', () => openFaceRegistration(!isFaceEnrolled));
  document.getElementById('registerFaceNowBtn')?.addEventListener('click', () => openFaceRegistration(true));
  document.getElementById('cancelFvBtn')?.addEventListener('click', () => {
    window.FaceVerification.destroy();
    document.getElementById('faceVerificationSection').classList.add('hidden');
    activeFvSession = null;
  });
  document.getElementById('refreshOpenBtn')?.addEventListener('click', () => {
    document.getElementById('openSessionsList').innerHTML = '<p class="text-sm text-slate-500 italic">Refreshing...</p>';
    loadOpenSessions();
  });
  document.getElementById('logoutBtn')?.addEventListener('click', logout);
});

// ── Tabs ──────────────────────────────────────────────────────────────────
let historyLoaded = false;

function switchTab(tab) {
  document.getElementById('tabCourses').classList.toggle('active', tab === 'courses');
  document.getElementById('tabHistory').classList.toggle('active', tab === 'history');
  document.getElementById('panelCourses').classList.toggle('hidden', tab !== 'courses');
  document.getElementById('panelHistory').classList.toggle('hidden', tab !== 'history');

  if (tab === 'history' && !historyLoaded) {
    loadHistory();
    historyLoaded = true;
  }
}

async function loadHistory() {
  const container = document.getElementById('historyContent');
  try {
    const data = await apiFetch('/api/student/attendance');
    const records = data.records || [];
    if (!records.length) {
      container.innerHTML = '<p class="text-center py-10 text-slate-400 italic text-sm">No attendance records found.</p>';
      return;
    }
    container.innerHTML = `<table class="w-full text-left text-sm text-slate-600">
      <thead class="bg-slate-50 text-xs text-slate-500 font-semibold uppercase tracking-wider border-b border-slate-100">
        <tr>
          <th class="px-6 py-3.5">Course</th>
          <th class="px-6 py-3.5">Session</th>
          <th class="px-6 py-3.5">Status</th>
          <th class="px-6 py-3.5">Source</th>
          <th class="px-6 py-3.5">Date</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-100 font-medium">
        ${records.map((r) => {
          const course = r.courseId || {};
          const session = r.sessionId || {};
          const statusBadge = r.status === 'present'
            ? '<span class="status-badge-present">✓ Present</span>'
            : r.status === 'absent'
            ? '<span class="status-badge-absent">✗ Absent</span>'
            : '<span class="status-badge-pending">⏳ Pending</span>';
          const source = { face_verification: '🤖 Auto', manual: '👨‍🏫 Manual', absent_default: '🔒 Auto-absent' }[r.decisionSource] || r.decisionSource;
          const date = r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—';
          return `<tr class="hover:bg-slate-50/60 transition-colors">
            <td class="px-6 py-4 font-semibold text-slate-900">${escHtml(course.code || '—')} — ${escHtml(course.title || '')}</td>
            <td class="px-6 py-4 text-slate-600">${escHtml(session.label || 'Session')}</td>
            <td class="px-6 py-4">${statusBadge}</td>
            <td class="px-6 py-4 text-xs text-slate-500">${source}</td>
            <td class="px-6 py-4 text-slate-500">${date}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  } catch (err) {
    container.innerHTML = '<p class="text-center py-8 text-red-500 italic text-sm">Failed to load attendance history.</p>';
  }
}

// ── Alerts ────────────────────────────────────────────────────────────────
function showAlert(msg, type = 'info') {
  const el = document.getElementById('alertBanner');
  if (!el) return;
  el.textContent = msg;
  el.className = `rounded-xl p-4 text-sm font-semibold transition-all ${
    type === 'success' ? 'bg-emerald-50 border border-emerald-200 text-emerald-800' :
    type === 'error' ? 'bg-red-50 border border-red-200 text-red-800' :
    'bg-blue-50 border border-blue-200 text-blue-800'
  }`;
  el.classList.remove('hidden');
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => el.classList.add('hidden'), 6000);
}

// ── Logout ────────────────────────────────────────────────────────────────
function logout() {
  window.FaceVerification && window.FaceVerification.destroy();
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  window.location.replace('/signin.html');
}

// ── Utils ─────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
