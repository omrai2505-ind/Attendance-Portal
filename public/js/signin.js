// ═══════════════════════════════════════════════════════════════════════════
// IIIT Dharwad Attendance Portal — Sign In Logic
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_DOMAIN = '@iiitdwd.ac.in';
let selectedRole = 'student';

// ── Auto-redirect if already logged in ────────────────────────────────────
(function checkExistingToken() {
  const token = localStorage.getItem('token');
  const role = localStorage.getItem('role');
  if (token) {
    // Redirect to the correct dashboard based on stored role
    if (role === 'teacher') {
      window.location.replace('/teacher-dashboard.html');
    } else {
      window.location.replace('/student-dashboard.html');
    }
  }
})();

// ── Show error from OAuth redirect, if any ────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const oauthError = urlParams.get('error');

// ── DOM Elements ──────────────────────────────────────────────────────────
const form = document.getElementById('signinForm');
const emailInput = document.getElementById('email');
const passInput = document.getElementById('password');
const submitBtn = document.getElementById('submitBtn');
const submitText = document.getElementById('submitText');
const emailError = document.getElementById('emailError');

// ── Role Toggle ───────────────────────────────────────────────────────────
function setRole(role) {
  selectedRole = role;
  const studentBtn = document.getElementById('roleStudent');
  const teacherBtn = document.getElementById('roleTeacher');

  studentBtn.classList.toggle('active', role === 'student');
  teacherBtn.classList.toggle('active', role === 'teacher');

  if (role === 'student') {
    emailInput.placeholder = '25bcs049@iiitdwd.ac.in';
  } else {
    emailInput.placeholder = 'ravi@iiitdwd.ac.in';
  }
}

// ── Email Validation ──────────────────────────────────────────────────────
emailInput.addEventListener('input', () => {
  const email = emailInput.value.trim().toLowerCase();

  if (email.length > 0 && email.includes('@')) {
    if (email.endsWith(ALLOWED_DOMAIN)) {
      emailInput.classList.remove('input-error');
      emailInput.classList.add('input-success');
      emailError.classList.add('hidden');
    } else {
      emailInput.classList.remove('input-success');
      emailInput.classList.add('input-error');
      emailError.textContent = `Only ${ALLOWED_DOMAIN} emails are allowed`;
      emailError.classList.remove('hidden');
    }
  } else {
    emailInput.classList.remove('input-error', 'input-success');
    emailError.classList.add('hidden');
  }
});

// ── Toggle Password Visibility ────────────────────────────────────────────
function togglePasswordVisibility(inputId, btn) {
  const input = document.getElementById(inputId);
  const eyeOpen = btn.querySelector('.eye-open');
  const eyeClosed = btn.querySelector('.eye-closed');

  if (input.type === 'password') {
    input.type = 'text';
    eyeOpen.classList.add('hidden');
    eyeClosed.classList.remove('hidden');
  } else {
    input.type = 'password';
    eyeOpen.classList.remove('hidden');
    eyeClosed.classList.add('hidden');
  }
}

// ── Toast Notification ────────────────────────────────────────────────────
function showToast(message, type = 'error') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// ── Form Submission ───────────────────────────────────────────────────────
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = emailInput.value.trim().toLowerCase();
  const password = passInput.value;

  // Validations
  if (!email || !password) {
    showToast('Please fill in all fields');
    return;
  }

  if (!email.endsWith(ALLOWED_DOMAIN)) {
    showToast(`Only ${ALLOWED_DOMAIN} emails are allowed`);
    return;
  }

  // Disable button and show loading
  submitBtn.disabled = true;
  submitText.innerHTML = '<span class="spinner"></span>';

  try {
    const res = await fetch('/api/auth/signin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (!res.ok) {
      // If user is unverified, redirect to verification page
      if (data.code === 'UNVERIFIED') {
        showToast('Account not verified. Redirecting...', 'error');
        setTimeout(() => {
          window.location.href = `/verify.html?email=${encodeURIComponent(data.email || email)}`;
        }, 1200);
        submitBtn.disabled = false;
        submitText.textContent = 'Sign In to Dashboard';
        return;
      }

      showToast(data.message || 'Sign in failed');
      submitBtn.disabled = false;
      submitText.textContent = 'Sign In to Dashboard';
      return;
    }

    // Success — store token and role, then redirect to correct dashboard
    localStorage.setItem('token', data.token);
    localStorage.setItem('role', data.user.role);
    showToast('Signed in successfully!', 'success');

    setTimeout(() => {
      if (data.user.role === 'teacher') {
        window.location.href = '/teacher-dashboard.html';
      } else {
        window.location.href = '/student-dashboard.html';
      }
    }, 600);

  } catch (err) {
    console.error('Signin error:', err);
    showToast('Network error. Please try again.');
    submitBtn.disabled = false;
    submitText.textContent = 'Sign In to Dashboard';
  }
});

// ── Show error from OAuth redirect, if any ────────────────────────────────
if (oauthError) {
  showToast('Verification failed. Please try again.', 'error');
  window.history.replaceState({}, document.title, '/signin.html');
}
