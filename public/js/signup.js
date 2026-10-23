// ═══════════════════════════════════════════════════════════════════════════
// IIIT Dharwad Attendance Portal — Sign Up Logic
// ═══════════════════════════════════════════════════════════════════════════

const ALLOWED_DOMAIN = '@iiitdwd.ac.in';
let selectedRole = 'student';

// ── DOM Elements ──────────────────────────────────────────────────────────
const form            = document.getElementById('signupForm');
const emailInput      = document.getElementById('email');
const passwordInput   = document.getElementById('password');
const confirmInput    = document.getElementById('confirmPassword');
const submitBtn       = document.getElementById('submitBtn');
const submitText      = document.getElementById('submitText');
const strengthBar     = document.getElementById('strengthBar');
const strengthText    = document.getElementById('strengthText');
const usernameDisplay = document.getElementById('usernameDisplay');
const usernameValue   = document.getElementById('usernameValue');
const emailError      = document.getElementById('emailError');
const confirmError    = document.getElementById('confirmError');

// ── Role Toggle ───────────────────────────────────────────────────────────
function setRole(role) {
  selectedRole = role;
  const studentBtn = document.getElementById('roleStudent');
  const teacherBtn = document.getElementById('roleTeacher');

  studentBtn.classList.toggle('active', role === 'student');
  teacherBtn.classList.toggle('active', role === 'teacher');

  // Update placeholder based on role
  if (role === 'student') {
    emailInput.placeholder = '25bcs049@iiitdwd.ac.in';
  } else {
    emailInput.placeholder = 'ravi@iiitdwd.ac.in';
  }
}

// ── Email Validation ──────────────────────────────────────────────────────
emailInput.addEventListener('input', () => {
  const email = emailInput.value.trim().toLowerCase();

  // Show/hide username extraction
  if (email.includes('@')) {
    const prefix = email.split('@')[0];
    if (prefix) {
      usernameValue.textContent = prefix;
      usernameDisplay.classList.remove('hidden');
    } else {
      usernameDisplay.classList.add('hidden');
    }
  } else if (email.length > 0) {
    usernameValue.textContent = email;
    usernameDisplay.classList.remove('hidden');
  } else {
    usernameDisplay.classList.add('hidden');
  }

  // Validate domain
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

// ── Password Strength Checker ─────────────────────────────────────────────
passwordInput.addEventListener('input', () => {
  const password = passwordInput.value;
  checkPasswordStrength(password);
  checkConfirmMatch();
});

function checkPasswordStrength(password) {
  const requirements = {
    length:    password.length >= 8,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number:    /[0-9]/.test(password),
    special:   /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password),
  };

  // Update requirement checklist
  Object.keys(requirements).forEach(key => {
    const item = document.querySelector(`[data-req="${key}"]`);
    if (!item) return;
    const icon = item.querySelector('.req-icon');

    if (requirements[key]) {
      item.classList.remove('unmet');
      item.classList.add('met');
      icon.textContent = '✓';
    } else {
      item.classList.remove('met');
      item.classList.add('unmet');
      icon.textContent = '○';
    }
  });

  // Calculate strength score (0-5)
  const score = Object.values(requirements).filter(Boolean).length;

  // Reset classes
  strengthBar.className = 'strength-bar-fill';

  if (password.length === 0) {
    strengthText.textContent = 'Password strength';
    strengthText.style.color = 'rgba(255,255,255,0.3)';
    return;
  }

  if (score <= 1) {
    strengthBar.classList.add('strength-weak');
    strengthText.textContent = 'Weak';
    strengthText.style.color = '#ef4444';
  } else if (score <= 2) {
    strengthBar.classList.add('strength-fair');
    strengthText.textContent = 'Fair';
    strengthText.style.color = '#f97316';
  } else if (score <= 4) {
    strengthBar.classList.add('strength-good');
    strengthText.textContent = 'Good';
    strengthText.style.color = '#eab308';
  } else {
    strengthBar.classList.add('strength-strong');
    strengthText.textContent = 'Strong 💪';
    strengthText.style.color = '#22c55e';
  }
}

// ── Confirm Password Match ────────────────────────────────────────────────
confirmInput.addEventListener('input', checkConfirmMatch);

function checkConfirmMatch() {
  const password = passwordInput.value;
  const confirm  = confirmInput.value;

  if (confirm.length === 0) {
    confirmInput.classList.remove('input-error', 'input-success');
    confirmError.classList.add('hidden');
    return;
  }

  if (password === confirm) {
    confirmInput.classList.remove('input-error');
    confirmInput.classList.add('input-success');
    confirmError.classList.add('hidden');
  } else {
    confirmInput.classList.remove('input-success');
    confirmInput.classList.add('input-error');
    confirmError.textContent = 'Passwords do not match';
    confirmError.classList.remove('hidden');
  }
}

// ── Toggle Password Visibility ────────────────────────────────────────────
function togglePasswordVisibility(inputId, btn) {
  const input   = document.getElementById(inputId);
  const eyeOpen   = btn.querySelector('.eye-open');
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

  const email    = emailInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const confirm  = confirmInput.value;

  // Validations
  if (!email || !password || !confirm) {
    showToast('Please fill in all fields');
    return;
  }

  if (!email.endsWith(ALLOWED_DOMAIN)) {
    showToast(`Only ${ALLOWED_DOMAIN} emails are allowed`);
    return;
  }

  const isStrong =
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);

  if (!isStrong) {
    showToast('Password does not meet all requirements');
    return;
  }

  if (password !== confirm) {
    showToast('Passwords do not match');
    return;
  }

  // Disable button and show loading
  submitBtn.disabled = true;
  submitText.innerHTML = '<span class="spinner"></span>';

  try {
    const res = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role: selectedRole })
    });

    const data = await res.json();

    if (!res.ok) {
      showToast(data.message || 'Sign up failed');
      submitBtn.disabled = false;
      submitText.textContent = 'Create Account';
      return;
    }

    // Signup returns pendingVerification — redirect to verify page
    if (data.pendingVerification) {
      showToast('Account created! Redirecting to verification...', 'success');
      setTimeout(() => {
        window.location.href = `/verify.html?email=${encodeURIComponent(data.email || email)}`;
      }, 800);
      return;
    }

    // Fallback (shouldn't normally happen)
    showToast('Account created successfully!', 'success');
    submitBtn.disabled = false;
    submitText.textContent = 'Create Account';

  } catch (err) {
    console.error('Signup error:', err);
    showToast('Network error. Please try again.');
    submitBtn.disabled = false;
    submitText.textContent = 'Create Account';
  }
});

// ── Auto-redirect if already logged in ────────────────────────────────────
if (localStorage.getItem('token')) {
  window.location.replace('/welcome.html');
}
