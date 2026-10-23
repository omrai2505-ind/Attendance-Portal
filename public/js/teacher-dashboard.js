// ═══════════════════════════════════════════════════════════════════════════
// IIIT Dharwad — Teacher Dashboard Logic
// ═══════════════════════════════════════════════════════════════════════════

// ── Token / OAuth handling ─────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
  localStorage.setItem('token', urlToken);
  localStorage.setItem('role', 'teacher');
  window.history.replaceState({}, document.title, '/teacher-dashboard.html');
}

const token = localStorage.getItem('token');
const role = localStorage.getItem('role');

if (!token) {
  window.location.replace('/signin.html');
} else if (role === 'student') {
  window.location.replace('/student-dashboard.html');
} else {
  initDashboard();
}

// ── Global State ────────────────────────────────────────────────────────────
let currentUser = null;
let dashboardData = null;
let coursesData = [];
let currentCourseId = null;
let currentCourseDetail = null;
let currentSessionId = null;
let currentRosterData = null;
let manualTargetStudentId = null;
let currentView = 'overview';

// ── API Helpers ─────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function apiFetchForm(path, formData, method = 'POST') {
  const res = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${token}` },
    body: formData
  });
  let data;
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) {
    const err = new Error(data.message || 'Request failed');
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// ── Escape HTML ──────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `fixed top-6 right-6 z-[9999] max-w-sm px-5 py-4 text-sm font-semibold rounded-2xl shadow-xl border transition-all ${
    type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
    : type === 'error'  ? 'bg-red-50 border-red-200 text-red-800'
    : 'bg-blue-50 border-blue-200 text-blue-800'
  }`;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.style.display = 'flex';
  }
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('hidden');
    el.style.display = 'none';
  }
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
    e.target.style.display = 'none';
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-backdrop').forEach((m) => {
      m.classList.add('hidden');
      m.style.display = 'none';
    });
  }
});

// ── Navigation ────────────────────────────────────────────────────────────────
const VIEWS = ['overview', 'courses', 'course-detail', 'sessions', 'attendance'];

function showView(view) {
  currentView = view;
  VIEWS.forEach((v) => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.add('hidden');
  });
  const target = document.getElementById(`view-${view}`);
  if (target) target.classList.remove('hidden');

  // Update nav
  document.querySelectorAll('[data-view]').forEach((btn) => {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
  });

  // Lazy-load sessions list
  if (view === 'sessions') loadAllSessions();
}

// ── Init ─────────────────────────────────────────────────────────────────────
async function initDashboard() {
  try {
    const meData = await apiFetch('/api/auth/me');
    currentUser = meData.user;

    if (currentUser.role !== 'teacher') {
      localStorage.setItem('role', currentUser.role);
      window.location.replace('/student-dashboard.html');
      return;
    }
    localStorage.setItem('role', 'teacher');

    const name = currentUser.username || currentUser.email.split('@')[0];
    document.getElementById('teacherName').textContent = name;
    document.getElementById('greetName').textContent = name;

    document.getElementById('logoutBtn').addEventListener('click', logout);

    // Keyboard and button bindings for Course Modal
    ['newCourseCode', 'newCourseTitle', 'newCourseSem'].forEach((id) => {
      document.getElementById(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          createCourse();
        }
      });
    });

    // Show app
    document.getElementById('loadingState').style.display = 'none';
    document.getElementById('appShell').classList.remove('hidden');

    // Load dashboard data
    await loadDashboard();
  } catch (err) {
    console.error('Teacher dashboard init failed:', err);
    if (err.status === 401 || err.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('role');
      window.location.replace('/signin.html');
    } else {
      document.getElementById('loadingState').innerHTML =
        `<div class="text-center text-red-600"><p class="font-semibold mb-2">Failed to load dashboard</p><p class="text-sm text-slate-500">${esc(err.message)}</p><a href="/signin.html" class="mt-4 inline-block text-blue-600 underline">Sign in again</a></div>`;
    }
  }
}

// ── Dashboard Overview ────────────────────────────────────────────────────────
async function loadDashboard() {
  try {
    dashboardData = await apiFetch('/api/teacher/dashboard');

    document.getElementById('metCourses').textContent = dashboardData.totalCourses ?? '0';
    document.getElementById('metStudents').textContent = dashboardData.totalStudents ?? '0';
    document.getElementById('metOpen').textContent = dashboardData.openSessions?.length ?? '0';
    document.getElementById('metPending').textContent = dashboardData.pendingReviewCount ?? '0';

    // Open sessions list
    const openEl = document.getElementById('openSessionsList');
    if (!dashboardData.openSessions?.length) {
      openEl.innerHTML = '<p class="px-6 py-6 text-sm text-slate-400 italic">No open attendance sessions right now.</p>';
    } else {
      openEl.innerHTML = dashboardData.openSessions.map((s) => `
        <div class="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors">
          <div>
            <p class="text-xs font-bold text-blue-700 uppercase tracking-wide">${esc(s.courseCode)}</p>
            <p class="text-sm font-semibold text-slate-900">${esc(s.label || 'Class Session')}</p>
            <p class="text-xs text-slate-500 mt-0.5">Opened: ${new Date(s.openedAt).toLocaleString()}</p>
          </div>
          <div class="flex gap-2">
            <button onclick="projectQrCode('${s._id}', '${esc(s.courseCode)} — ${esc(s.courseTitle)}', '${esc(s.label || 'Session')}')" class="btn-primary btn-sm flex items-center gap-1">
              <span>📽️</span> Project QR
            </button>
            <button onclick="viewRoster('${s._id}')" class="btn-secondary btn-sm">View Roster</button>
            <button onclick="closeSession('${s._id}')" class="btn-danger btn-sm">Close</button>
          </div>
        </div>`).join('');
    }

    // Recent sessions
    const recentEl = document.getElementById('recentSessionsList');
    if (!dashboardData.recentSessions?.length) {
      recentEl.innerHTML = '<p class="px-6 py-6 text-sm text-slate-400 italic">No completed sessions yet.</p>';
    } else {
      recentEl.innerHTML = dashboardData.recentSessions.map((s) => `
        <div class="px-6 py-4 flex items-center justify-between gap-4 hover:bg-slate-50/60 transition-colors">
          <div>
            <p class="text-xs font-bold text-slate-500 uppercase tracking-wide">${esc(s.courseCode)}</p>
            <p class="text-sm font-semibold text-slate-900">${esc(s.label || 'Class Session')}</p>
            <p class="text-xs text-slate-500 mt-0.5">Closed: ${new Date(s.closedAt).toLocaleString()}</p>
          </div>
          <button onclick="viewRoster('${s._id}')" class="btn-secondary btn-sm">View Roster</button>
        </div>`).join('');
    }

    // Also pre-load courses
    await loadCourses();
  } catch (err) {
    toast('Failed to load dashboard: ' + err.message, 'error');
  }
}

// ── Courses ────────────────────────────────────────────────────────────────────
async function loadCourses() {
  try {
    const data = await apiFetch('/api/teacher/courses');
    coursesData = data.courses || [];
    renderCoursesList();
  } catch (err) {
    document.getElementById('coursesList').innerHTML =
      `<div class="dash-card p-6 col-span-full text-sm text-red-500 italic">Failed to load courses: ${esc(err.message)}</div>`;
  }
}

function renderCoursesList() {
  const el = document.getElementById('coursesList');
  if (!coursesData.length) {
    el.innerHTML = `<div class="dash-card p-10 col-span-full text-center">
      <p class="text-3xl mb-3">📚</p>
      <p class="font-semibold text-slate-700">No courses yet</p>
      <p class="text-sm text-slate-500 mt-1">Create your first course to get started.</p>
      <button onclick="openCreateCourseModal()" class="btn-primary mt-4">+ New Course</button>
    </div>`;
    return;
  }

  el.innerHTML = coursesData.map((c) => `
    <div class="dash-card p-6 flex flex-col gap-4 hover:shadow-md transition-shadow cursor-pointer" onclick="openCourseDetail('${c._id}')">
      <div class="flex items-start justify-between">
        <div>
          <span class="text-xs font-bold bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-full">${esc(c.code)}</span>
          <h3 class="text-base font-bold text-slate-900 mt-2">${esc(c.title)}</h3>
          <p class="text-xs text-slate-500 mt-0.5">${esc(c.semester || 'No semester set')}</p>
        </div>
        <span class="${c.isActive ? 'badge-open' : 'badge-closed'}">${c.isActive ? '● Active' : '○ Inactive'}</span>
      </div>
      <div class="flex items-center justify-between text-xs text-slate-500 border-t border-slate-100 pt-3 mt-auto">
        <span>👥 ${c.studentCount || 0} students</span>
        <button onclick="event.stopPropagation(); openCourseDetail('${c._id}')" class="text-blue-600 font-semibold hover:underline">Manage →</button>
      </div>
    </div>`).join('');
}

// ── Course Detail ─────────────────────────────────────────────────────────────
async function openCourseDetail(courseId) {
  currentCourseId = courseId;
  showView('course-detail');

  document.getElementById('cdCourseTitle').textContent = 'Loading...';
  document.getElementById('cdStudentList').innerHTML = '<p class="px-6 py-6 text-sm text-slate-400 italic">Loading...</p>';
  document.getElementById('cdSessionsList').innerHTML = '<p class="px-6 py-6 text-sm text-slate-400 italic">Loading...</p>';

  try {
    const [courseData, sessionsData] = await Promise.all([
      apiFetch(`/api/teacher/courses/${courseId}`),
      apiFetch(`/api/teacher/courses/${courseId}/sessions`)
    ]);

    currentCourseDetail = courseData.course;
    const course = courseData.course;

    document.getElementById('cdCourseTitle').textContent = `${course.code} — ${course.title}`;
    document.getElementById('cdCourseMeta').textContent =
      `${course.semester || 'No semester'} · ${course.students?.length || 0} students enrolled`;

    // Students
    const students = course.students || [];
    document.getElementById('cdStudentCount').textContent = students.length;
    if (!students.length) {
      document.getElementById('cdStudentList').innerHTML =
        '<p class="px-6 py-8 text-sm text-slate-400 italic text-center">No students enrolled yet. Use the form above to add students.</p>';
    } else {
      document.getElementById('cdStudentList').innerHTML = `
        <table class="data-table">
          <thead><tr><th>Username</th><th>Email</th><th>Action</th></tr></thead>
          <tbody>
            ${students.map((s) => `<tr>
              <td class="font-medium text-slate-900">${esc(s.username)}</td>
              <td class="text-slate-600">${esc(s.email)}</td>
              <td><button onclick="removeStudent('${s._id}')" class="btn-danger btn-sm text-xs">Remove</button></td>
            </tr>`).join('')}
          </tbody>
        </table>`;
    }

    // Sessions
    renderCourseSessionsList(sessionsData.sessions || []);
  } catch (err) {
    toast('Failed to load course: ' + err.message, 'error');
  }
}

function renderCourseSessionsList(sessions) {
  const el = document.getElementById('cdSessionsList');
  if (!sessions.length) {
    el.innerHTML = '<p class="px-6 py-8 text-sm text-slate-400 italic text-center">No sessions yet. Create the first one.</p>';
    return;
  }
  el.innerHTML = `<table class="data-table">
    <thead><tr><th>Label</th><th>Status</th><th>Present</th><th>Absent</th><th>Pending</th><th>Actions</th></tr></thead>
    <tbody>
      ${sessions.map((s) => {
        const badgeClass = s.status === 'open' ? 'badge-open' : s.status === 'closed' ? 'badge-closed' : 'badge-draft';
        const badgeText = s.status === 'open' ? '● Open' : s.status === 'closed' ? '✓ Closed' : '○ Draft';
        const openBtn = s.status === 'draft' ? `<button onclick="promptOpenSession('${s._id}', '${esc(s.label || 'Session')}')" class="btn-success btn-sm">Open</button>` : '';
        const projectBtn = s.status === 'open' ? `<button onclick="projectQrCode('${s._id}', '${esc(currentCourseDetail?.code || '')}', '${esc(s.label || 'Session')}')" class="btn-primary btn-sm flex items-center gap-1"><span>📽️</span> QR</button>` : '';
        const closeBtn = s.status === 'open' ? `<button onclick="closeSession('${s._id}')" class="btn-danger btn-sm">Close</button>` : '';
        const rosterBtn = s.status !== 'draft' ? `<button onclick="viewRoster('${s._id}')" class="btn-secondary btn-sm">Roster</button>` : '';
        return `<tr>
          <td class="font-semibold text-slate-900">${esc(s.label || 'Session')}</td>
          <td><span class="${badgeClass}">${badgeText}</span></td>
          <td class="text-emerald-700 font-semibold">${s.presentCount || 0}</td>
          <td class="text-red-700 font-semibold">${s.absentCount || 0}</td>
          <td class="text-amber-700 font-semibold">${s.pendingCount || 0}</td>
          <td class="flex gap-2">${openBtn}${projectBtn}${closeBtn}${rosterBtn}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

// ── All Sessions (Sessions View) ─────────────────────────────────────────────
async function loadAllSessions() {
  const container = document.getElementById('allSessionsContent');
  container.innerHTML = '<p class="px-6 py-8 text-sm text-slate-400 italic text-center">Loading sessions...</p>';

  if (!coursesData.length) {
    try { await loadCourses(); } catch { /* ignore */ }
  }
  if (!coursesData.length) {
    container.innerHTML = '<p class="px-6 py-8 text-sm text-slate-400 italic text-center">You have no courses yet.</p>';
    return;
  }

  try {
    const courseIds = coursesData.map((c) => c._id);
    const sessionArrays = await Promise.all(
      courseIds.map((id) => apiFetch(`/api/teacher/courses/${id}/sessions`).then((d) => d.sessions || []))
    );
    const courseMap = {};
    coursesData.forEach((c) => { courseMap[c._id] = c; });
    const allSessions = sessionArrays.flatMap((arr, i) =>
      arr.map((s) => ({ ...s, course: courseMap[courseIds[i]] }))
    ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    if (!allSessions.length) {
      container.innerHTML = '<p class="px-6 py-8 text-sm text-slate-400 italic text-center">No sessions created yet.</p>';
      return;
    }

    container.innerHTML = `<table class="data-table">
      <thead><tr><th>Course</th><th>Label</th><th>Status</th><th>Present</th><th>Absent</th><th>Pending</th><th>Created</th><th>Actions</th></tr></thead>
      <tbody>
        ${allSessions.map((s) => {
          const c = s.course || {};
          const badgeClass = s.status === 'open' ? 'badge-open' : s.status === 'closed' ? 'badge-closed' : 'badge-draft';
          const badgeText = s.status === 'open' ? '● Open' : s.status === 'closed' ? '✓ Closed' : '○ Draft';
          const openBtn = s.status === 'draft' ? `<button onclick="promptOpenSession('${s._id}', '${esc(s.label || 'Session')}')" class="btn-success btn-sm">Open</button>` : '';
          const projectBtn = s.status === 'open' ? `<button onclick="projectQrCode('${s._id}', '${esc(c.code || '')} — ${esc(c.title || '')}', '${esc(s.label || 'Session')}')" class="btn-primary btn-sm flex items-center gap-1"><span>📽️</span> QR</button>` : '';
          const closeBtn = s.status === 'open' ? `<button onclick="closeSession('${s._id}')" class="btn-danger btn-sm">Close</button>` : '';
          const rosterBtn = s.status !== 'draft' ? `<button onclick="viewRoster('${s._id}')" class="btn-secondary btn-sm">Roster</button>` : '';
          const date = new Date(s.createdAt).toLocaleDateString();
          return `<tr>
            <td><span class="text-xs font-bold text-blue-700">${esc(c.code || '—')}</span></td>
            <td class="font-semibold text-slate-900">${esc(s.label || 'Session')}</td>
            <td><span class="${badgeClass}">${badgeText}</span></td>
            <td class="text-emerald-700 font-semibold">${s.presentCount || 0}</td>
            <td class="text-red-700 font-semibold">${s.absentCount || 0}</td>
            <td class="text-amber-700 font-semibold">${s.pendingCount || 0}</td>
            <td class="text-slate-500">${date}</td>
            <td class="flex gap-2">${openBtn}${projectBtn}${closeBtn}${rosterBtn}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>`;
  } catch (err) {
    container.innerHTML = `<p class="px-6 py-8 text-red-500 italic text-sm text-center">Failed to load sessions: ${esc(err.message)}</p>`;
  }
}

// ── Session Operations ────────────────────────────────────────────────────────
// ── Session Operations & Classroom Location Geofencing ─────────────────────
let pendingOpenSessionId = null;
let projectorInterval = null;
let projectorCountdownTimer = null;
let liveRosterInterval = null;
let projectorActiveSessionId = null;

function promptOpenSession(sessionId, sessionLabel) {
  pendingOpenSessionId = sessionId;
  document.getElementById('openLocationSessionLabel').textContent = sessionLabel || 'Set geofence before opening session';
  document.getElementById('openLocationError').classList.add('hidden');
  document.getElementById('teacherGpsStatus').textContent = '';
  // Set default radius 50m
  document.getElementById('sessionRadiusInput').value = 50;
  openModal('modalOpenSessionLocation');
}

function detectTeacherLocation() {
  const statusEl = document.getElementById('teacherGpsStatus');
  const latInput = document.getElementById('sessionLatInput');
  const lonInput = document.getElementById('sessionLonInput');
  const btn = document.getElementById('detectTeacherLocationBtn');

  if (!navigator.geolocation) {
    statusEl.innerHTML = '<span class="text-red-500">Geolocation is not supported by your browser. Please enter coordinates manually.</span>';
    return;
  }

  btn.disabled = true;
  statusEl.innerHTML = '<span class="text-blue-600 animate-pulse">Requesting GPS coordinates from browser...</span>';

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      btn.disabled = false;
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : 'unknown';
      latInput.value = lat;
      lonInput.value = lon;
      statusEl.innerHTML = `<span class="text-emerald-700 font-semibold">✓ Detected: (${lat.toFixed(6)}, ${lon.toFixed(6)}) with reported accuracy ±${acc}m. Review and adjust before confirming.</span>`;
    },
    (err) => {
      btn.disabled = false;
      statusEl.innerHTML = `<span class="text-red-500">Could not retrieve GPS: ${err.message}. Please enter classroom latitude/longitude manually.</span>`;
    },
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

async function confirmOpenSession() {
  const errEl = document.getElementById('openLocationError');
  errEl.classList.add('hidden');

  const lat = parseFloat(document.getElementById('sessionLatInput').value);
  const lon = parseFloat(document.getElementById('sessionLonInput').value);
  const radius = parseFloat(document.getElementById('sessionRadiusInput').value);

  if (isNaN(lat) || lat < -90 || lat > 90) {
    errEl.textContent = 'Please provide a valid classroom latitude between -90 and 90.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(lon) || lon < -180 || lon > 180) {
    errEl.textContent = 'Please provide a valid classroom longitude between -180 and 180.';
    errEl.classList.remove('hidden');
    return;
  }
  if (isNaN(radius) || radius <= 0 || radius > 500) {
    errEl.textContent = 'Please provide a valid positive radius up to 500 meters.';
    errEl.classList.remove('hidden');
    return;
  }

  const btn = document.getElementById('confirmOpenSessionBtn');
  btn.disabled = true;
  btn.textContent = 'Opening...';

  try {
    const data = await apiFetch(`/api/teacher/sessions/${pendingOpenSessionId}/open`, {
      method: 'PATCH',
      body: JSON.stringify({
        latitude: lat,
        longitude: lon,
        radiusMeters: radius
      })
    });

    closeModal('modalOpenSessionLocation');
    toast('Session is now open for attendance with location geofence!', 'success');
    refreshCurrentView();
    if (currentView === 'overview') await loadDashboard();

    // Proactively offer to open projector mode
    const s = data.session;
    projectQrCode(s._id, 'Class Attendance', s.label || 'Session');
  } catch (err) {
    errEl.textContent = err.data?.message || err.message || 'Failed to open session';
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Confirm & Open Session';
  }
}

// Backward compatibility alias for any existing openSession calls
async function openSession(sessionId) {
  promptOpenSession(sessionId, 'Class Session');
}

// ── Projector Mode & Rotating Dynamic QR Code ───────────────────────────────
let qrCodeInstance = null;

async function projectQrCode(sessionId, courseTitle, sessionLabel) {
  projectorActiveSessionId = sessionId;
  document.getElementById('projectorCourseTitle').textContent = courseTitle || 'Class Attendance';
  document.getElementById('projectorSessionLabel').textContent = sessionLabel || 'Session';

  openModal('modalProjectorQr');
  await renderDynamicQr(sessionId);
  startProjectorTimers(sessionId);
}

async function renderDynamicQr(sessionId) {
  const container = document.getElementById('projectorQrContainer');
  const statusEl = document.getElementById('projectorRefreshStatus');

  try {
    statusEl.innerHTML = '<span class="text-blue-600 animate-spin">⟳</span> Refreshing...';
    const data = await apiFetch(`/api/teacher/sessions/${sessionId}/qr-token`);
    container.innerHTML = '';

    // Render QR Code Image (server-generated data URL for 100% offline reliability)
    if (data.qrDataUrl) {
      container.innerHTML = `<img src="${data.qrDataUrl}" alt="Dynamic Attendance QR Code" class="w-64 h-64 max-w-full mx-auto object-contain rounded-2xl shadow-sm border border-slate-100" />`;
    } else if (window.QRCode) {
      qrCodeInstance = new window.QRCode(container, {
        text: data.payload,
        width: 256,
        height: 256,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } else {
      container.innerHTML = `<div class="p-4 bg-slate-100 rounded text-xs break-all">${esc(data.payload)}</div>`;
    }

    statusEl.innerHTML = '✓ Active';
    const duration = data.windowDurationSeconds || 30;
    updateCountdown(data.remainingSeconds !== undefined ? data.remainingSeconds : duration);
  } catch (err) {
    statusEl.innerHTML = '<span class="text-red-500">Failed to refresh QR</span>';
    container.innerHTML = `<p class="text-xs text-red-500 p-4">Error loading QR code: ${esc(err.message)}</p>`;
  }
}

function updateCountdown(seconds) {
  const el = document.getElementById('projectorCountdown');
  if (el) el.textContent = seconds;
}

function startProjectorTimers(sessionId) {
  clearInterval(projectorInterval);
  clearInterval(projectorCountdownTimer);
  clearInterval(liveRosterInterval);

  let currentRemaining = 30;

  // Countdown timer ticks every 1 second
  projectorCountdownTimer = setInterval(() => {
    currentRemaining -= 1;
    if (currentRemaining < 0) {
      currentRemaining = 30;
    }
    updateCountdown(currentRemaining);
  }, 1000);

  // Stable QR refresh every 30 seconds
  projectorInterval = setInterval(() => {
    if (projectorActiveSessionId) {
      renderDynamicQr(projectorActiveSessionId);
      currentRemaining = 30;
    }
  }, 30000);

  // Live attendance count polls every 3 seconds
  pollLiveAttendance(sessionId);
  liveRosterInterval = setInterval(() => {
    if (projectorActiveSessionId) {
      pollLiveAttendance(projectorActiveSessionId);
    }
  }, 3000);
}

async function pollLiveAttendance(sessionId) {
  try {
    const data = await apiFetch(`/api/teacher/sessions/${sessionId}/roster`);
    if (data.summary) {
      document.getElementById('projectorPresentCount').textContent = data.summary.present || 0;
      document.getElementById('projectorPendingCount').textContent = data.summary.pending || 0;
      document.getElementById('projectorTotalCount').textContent = data.summary.total || 0;
    }
  } catch (err) {
    // If session closed, notify and stop polling
    if (err.status === 400 || err.status === 404) {
      clearInterval(liveRosterInterval);
      clearInterval(projectorInterval);
      clearInterval(projectorCountdownTimer);
    }
  }
}

function closeProjectorMode() {
  projectorActiveSessionId = null;
  clearInterval(projectorInterval);
  clearInterval(projectorCountdownTimer);
  clearInterval(liveRosterInterval);
  closeModal('modalProjectorQr');
  refreshCurrentView();
}

async function closeSession(sessionId) {
  if (!confirm('Close this session? All remaining unrecorded students will be marked absent.')) return;
  try {
    const data = await apiFetch(`/api/teacher/sessions/${sessionId}/close`, { method: 'PATCH' });
    toast(`Session closed — Present: ${data.summary.present}, Absent: ${data.summary.absent}`, 'success');
    if (projectorActiveSessionId === sessionId) {
      closeProjectorMode();
    }
    refreshCurrentView();
    await loadDashboard();
  } catch (err) {
    toast('Failed to close session: ' + err.message, 'error');
  }
}

function refreshCurrentView() {
  if (currentView === 'overview') loadDashboard();
  else if (currentView === 'sessions') loadAllSessions();
  else if (currentView === 'course-detail' && currentCourseId) openCourseDetail(currentCourseId);
  else if (currentView === 'attendance' && currentSessionId) viewRoster(currentSessionId);
}

// ── Roster (Attendance View) ─────────────────────────────────────────────────
async function viewRoster(sessionId) {
  currentSessionId = sessionId;
  showView('attendance');
  document.getElementById('rosterSessionTitle').textContent = 'Loading roster...';
  document.getElementById('rosterCourseMeta').textContent = '—';
  document.getElementById('rosterTableBody').innerHTML =
    '<tr><td colspan="5" class="text-center py-8 text-slate-400 italic">Loading...</td></tr>';

  try {
    const data = await apiFetch(`/api/teacher/sessions/${sessionId}/roster`);
    currentRosterData = data;

    const session = data.session;
    const course = data.course;
    const roster = data.roster || [];
    const summary = data.summary || {};

    document.getElementById('rosterSessionTitle').textContent = session.label || 'Session Roster';
    document.getElementById('rosterCourseMeta').textContent = `${course.code} — ${course.title}`;

    // Status badge
    const badgeClass = session.status === 'open' ? 'badge-open' : session.status === 'closed' ? 'badge-closed' : 'badge-draft';
    const badgeText = session.status === 'open' ? '● Attendance Open' : session.status === 'closed' ? '✓ Closed' : '○ Draft';
    document.getElementById('rosterStatusBadge').innerHTML = `<span class="${badgeClass}">${badgeText}</span>`;

    // Controls
    const controlsEl = document.getElementById('rosterControls');
    let controlHtml = '';
    if (session.status === 'draft') {
      controlHtml = `<button onclick="openSession('${session._id}')" class="btn-success btn-sm">Open Attendance</button>`;
    } else if (session.status === 'open') {
      controlHtml = `
        <button onclick="viewRoster('${session._id}')" class="btn-secondary btn-sm">↺ Refresh</button>
        <button onclick="closeSession('${session._id}')" class="btn-danger btn-sm">Close Session</button>`;
    } else {
      controlHtml = `<button onclick="viewRoster('${session._id}')" class="btn-secondary btn-sm">↺ Refresh</button>`;
    }
    controlsEl.innerHTML = controlHtml;

    // Summary counts
    document.getElementById('rosterPresentCount').textContent = summary.present || 0;
    document.getElementById('rosterAbsentCount').textContent = summary.absent || 0;
    document.getElementById('rosterPendingCount').textContent = summary.pending || 0;
    document.getElementById('rosterTotal').textContent = summary.total || 0;

    // Table
    const tbody = document.getElementById('rosterTableBody');
    if (!roster.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-slate-400 italic">No students enrolled in this course.</td></tr>';
      return;
    }

    tbody.innerHTML = roster.map((row) => {
      const student = row.student || {};
      const status = row.attendanceStatus;
      let statusBadge;
      if (status === 'present') statusBadge = '<span class="badge-present">✓ Present</span>';
      else if (status === 'absent') statusBadge = '<span class="badge-absent">✗ Absent</span>';
      else if (status === 'pending') statusBadge = '<span class="badge-pending">⏳ Pending</span>';
      else statusBadge = '<span class="badge-draft">— No record</span>';

      const source = { face_verification: '🤖 Auto', manual: '👨‍🏫 Manual', absent_default: '🔒 Auto-absent' }[row.decisionSource] || '—';
      const canMark = session.status === 'open' || session.status === 'closed';

      return `<tr>
        <td class="font-semibold text-slate-900">${esc(student.username || '—')}</td>
        <td class="text-slate-600">${esc(student.email || '—')}</td>
        <td>${statusBadge}</td>
        <td class="text-xs text-slate-500">${source}</td>
        <td>${canMark
          ? `<button onclick="openManualModal('${student._id}', '${esc(student.username || student.email)}')" class="btn-secondary btn-sm text-xs">${status === 'no_record' ? 'Mark' : 'Correct'}</button>`
          : '—'}</td>
      </tr>`;
    }).join('');
  } catch (err) {
    toast('Failed to load roster: ' + err.message, 'error');
    document.getElementById('rosterTableBody').innerHTML =
      `<tr><td colspan="5" class="text-center py-6 text-red-500">${esc(err.message)}</td></tr>`;
  }
}

// ── Manual Attendance ─────────────────────────────────────────────────────────
function openManualModal(studentId, studentName) {
  manualTargetStudentId = studentId;
  document.getElementById('manualStudentInfo').textContent = `Student: ${studentName}`;
  document.getElementById('manualStatus').value = 'present';
  document.getElementById('manualNote').value = '';
  document.getElementById('manualAttendanceError').classList.add('hidden');
  openModal('modalManualAttendance');
}

async function submitManualAttendance() {
  const status = document.getElementById('manualStatus').value;
  const note = document.getElementById('manualNote').value.trim();
  const errEl = document.getElementById('manualAttendanceError');
  const btn = document.getElementById('manualSubmitBtn');

  errEl.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    await apiFetch(`/api/teacher/sessions/${currentSessionId}/attendance`, {
      method: 'POST',
      body: JSON.stringify({ studentId: manualTargetStudentId, status, note })
    });
    closeModal('modalManualAttendance');
    toast(`Attendance marked as ${status}`, 'success');
    // Refresh roster
    await viewRoster(currentSessionId);
  } catch (err) {
    errEl.textContent = err.data?.message || err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Decision';
  }
}

// ── Course Operations ──────────────────────────────────────────────────────────
function openCreateCourseModal() {
  const codeEl = document.getElementById('newCourseCode');
  const titleEl = document.getElementById('newCourseTitle');
  const semEl = document.getElementById('newCourseSem');
  const descEl = document.getElementById('newCourseDesc');
  const errEl = document.getElementById('createCourseError');
  if (codeEl) codeEl.value = '';
  if (titleEl) titleEl.value = '';
  if (semEl) semEl.value = '';
  if (descEl) descEl.value = '';
  if (errEl) errEl.classList.add('hidden');
  openModal('modalCreateCourse');
  setTimeout(() => codeEl?.focus(), 50);
}

async function createCourse() {
  const code = document.getElementById('newCourseCode').value.trim();
  const title = document.getElementById('newCourseTitle').value.trim();
  const semester = document.getElementById('newCourseSem').value.trim();
  const description = document.getElementById('newCourseDesc').value.trim();
  const errEl = document.getElementById('createCourseError');
  const btn = document.getElementById('createCourseBtn');

  if (!code || !title) {
    errEl.textContent = 'Course code and title are required.';
    errEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Creating...';
  errEl.classList.add('hidden');

  try {
    await apiFetch('/api/teacher/courses', {
      method: 'POST',
      body: JSON.stringify({ code, title, semester, description })
    });
    closeModal('modalCreateCourse');
    toast('Course created successfully', 'success');
    await loadCourses();
    loadDashboard();
  } catch (err) {
    errEl.textContent = err.data?.message || err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Course';
  }
}

// ── Enroll Students ───────────────────────────────────────────────────────────
async function enrollStudents() {
  const raw = document.getElementById('enrollEmails').value.trim();
  const emails = raw.split('\n').map((e) => e.trim()).filter(Boolean);
  const resultEl = document.getElementById('enrollResult');
  const btn = document.getElementById('enrollBtn');

  if (!emails.length) {
    resultEl.textContent = 'Please enter at least one email address.';
    resultEl.className = 'text-xs mt-2 p-3 rounded-xl border bg-red-50 border-red-200 text-red-700';
    resultEl.classList.remove('hidden');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Enrolling...';

  try {
    const data = await apiFetch(`/api/teacher/courses/${currentCourseId}/enroll`, {
      method: 'POST',
      body: JSON.stringify({ emails })
    });

    const parts = [];
    if (data.enrolled?.length) parts.push(`✓ Enrolled: ${data.enrolled.map((s) => s.email).join(', ')}`);
    if (data.alreadyEnrolled?.length) parts.push(`ℹ Already enrolled: ${data.alreadyEnrolled.map((s) => s.email).join(', ')}`);
    if (data.notFound?.length) parts.push(`✗ Not found (must sign up first): ${data.notFound.join(', ')}`);

    resultEl.innerHTML = parts.map((p) => `<p>${esc(p)}</p>`).join('');
    resultEl.className = 'text-xs mt-2 p-3 rounded-xl border bg-emerald-50 border-emerald-200 text-emerald-800';
    resultEl.classList.remove('hidden');
    document.getElementById('enrollEmails').value = '';

    // Refresh student list
    await openCourseDetail(currentCourseId);
  } catch (err) {
    resultEl.textContent = err.data?.message || err.message;
    resultEl.className = 'text-xs mt-2 p-3 rounded-xl border bg-red-50 border-red-200 text-red-700';
    resultEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enroll Students';
  }
}

// ── Remove Student ────────────────────────────────────────────────────────────
async function removeStudent(studentId) {
  if (!confirm('Remove this student from the course?')) return;
  try {
    await apiFetch(`/api/teacher/courses/${currentCourseId}/enroll/${studentId}`, { method: 'DELETE' });
    toast('Student removed from course', 'success');
    await openCourseDetail(currentCourseId);
  } catch (err) {
    toast('Failed to remove student: ' + err.message, 'error');
  }
}

// ── Session Modal ─────────────────────────────────────────────────────────────
function openCreateSessionModal() {
  document.getElementById('newSessionLabel').value = '';
  document.getElementById('newSessionDate').value = '';
  document.getElementById('createSessionError').classList.add('hidden');
  openModal('modalCreateSession');
}

async function createSession() {
  const label = document.getElementById('newSessionLabel').value.trim();
  const scheduledAt = document.getElementById('newSessionDate').value || null;
  const errEl = document.getElementById('createSessionError');
  const btn = document.getElementById('createSessionBtn');

  btn.disabled = true;
  btn.textContent = 'Creating...';
  errEl.classList.add('hidden');

  try {
    await apiFetch(`/api/teacher/courses/${currentCourseId}/sessions`, {
      method: 'POST',
      body: JSON.stringify({ label, scheduledAt })
    });
    closeModal('modalCreateSession');
    toast('Session created', 'success');
    await openCourseDetail(currentCourseId);
  } catch (err) {
    errEl.textContent = err.data?.message || err.message;
    errEl.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Create Session';
  }
}

// ── Logout ────────────────────────────────────────────────────────────────────
function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  window.location.replace('/signin.html');
}

// ── Window Exports for HTML inline events ──────────────────────────────────────
window.openCreateCourseModal = openCreateCourseModal;
window.createCourse = createCourse;
window.openCreateSessionModal = openCreateSessionModal;
window.createSession = createSession;
window.openModal = openModal;
window.closeModal = closeModal;
window.showView = showView;
window.openCourseDetail = openCourseDetail;
window.viewRoster = viewRoster;
window.openManualModal = openManualModal;
window.submitManualAttendance = submitManualAttendance;
window.openSession = openSession;
window.closeSession = closeSession;
window.enrollStudents = enrollStudents;
window.removeStudent = removeStudent;
window.logout = logout;
window.loadCourses = loadCourses;
