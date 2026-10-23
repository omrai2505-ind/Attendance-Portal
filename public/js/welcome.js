// Legacy welcome.html redirect — forwards to role-specific dashboards.
// This handles old bookmarks and any lingering OAuth redirects to /welcome.html.

const urlParams = new URLSearchParams(window.location.search);
const urlToken = urlParams.get('token');
if (urlToken) {
  localStorage.setItem('token', urlToken);
  window.history.replaceState({}, document.title, '/welcome.html');
}

const token = localStorage.getItem('token');
if (!token) {
  window.location.replace('/signin.html');
} else {
  // Determine role from stored value, or fetch from /api/auth/me
  const role = localStorage.getItem('role');
  if (role === 'teacher') {
    window.location.replace('/teacher-dashboard.html');
  } else if (role === 'student') {
    window.location.replace('/student-dashboard.html');
  } else {
    // Fetch from server to determine role
    fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data) => {
        if (data.success && data.user) {
          localStorage.setItem('role', data.user.role);
          if (data.user.role === 'teacher') {
            window.location.replace('/teacher-dashboard.html');
          } else {
            window.location.replace('/student-dashboard.html');
          }
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('role');
          window.location.replace('/signin.html');
        }
      })
      .catch(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('role');
        window.location.replace('/signin.html');
      });
  }
}

// Stub to prevent errors if face-verification.js calls FaceVerification.destroy()
window.FaceVerification = window.FaceVerification || { destroy: () => {} };
function logout() {
  window.FaceVerification.destroy();
  localStorage.removeItem('token');
  localStorage.removeItem('role');
  window.location.replace('/signin.html');
}
