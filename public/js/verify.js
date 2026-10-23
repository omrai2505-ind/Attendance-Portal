// ═══════════════════════════════════════════════════════════════════════════
// IIIT Dharwad Attendance Portal — Google Verification Logic
// ═══════════════════════════════════════════════════════════════════════════

// ── Read URL parameters ──────────────────────────────────────────────────
const urlParams = new URLSearchParams(window.location.search);
const email     = urlParams.get('email');
const error     = urlParams.get('error');

// ── DOM elements ─────────────────────────────────────────────────────────
const stepEmailEl   = document.getElementById('stepEmail');
const infoEmailEl   = document.getElementById('infoEmail');
const errorAlert    = document.getElementById('errorAlert');
const errorMessage  = document.getElementById('errorMessage');
const verifyBtn     = document.getElementById('verifyBtn');

// ── Populate email display ───────────────────────────────────────────────
if (email) {
  stepEmailEl.textContent = email;
  infoEmailEl.textContent = email;
} else {
  // No email provided — redirect to signup
  window.location.replace('/signup.html');
}

// ── Handle error states from Google callback redirect ────────────────────
if (error) {
  errorAlert.classList.remove('hidden');

  switch (error) {
    case 'email_mismatch':
      errorMessage.textContent =
        'The Google account you signed in with doesn\'t match your signup email. Please try again with the correct account.';
      break;
    case 'invalid_email':
      errorMessage.textContent =
        'Invalid email address. Please go back and sign up again.';
      break;
    case 'google_auth_failed':
      errorMessage.textContent =
        'Google authentication failed. Please try again.';
      break;
    default:
      errorMessage.textContent =
        'Something went wrong. Please try again.';
  }
}

// ── Toast Notification ───────────────────────────────────────────────────
function showToast(message, type = 'error') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast toast-${type} show`;

  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// ── Start Google Verification ────────────────────────────────────────────
function startVerification() {
  if (!email) {
    showToast('No email found. Please sign up first.');
    return;
  }

  // Redirect to the verification-specific Google OAuth route
  window.location.href = `/api/auth/google/verify?email=${encodeURIComponent(email)}`;
}

// ── If already logged in, go to dashboard ────────────────────────────────
if (localStorage.getItem('token')) {
  window.location.replace('/welcome.html');
}
