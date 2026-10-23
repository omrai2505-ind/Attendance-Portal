const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const passport = require('passport');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// ─── Helpers ────────────────────────────────────────────────────────────────

const ALLOWED_DOMAIN = '@iiitdwd.ac.in';

const isValidEmail = (email) =>
  typeof email === 'string' && email.toLowerCase().endsWith(ALLOWED_DOMAIN);

const isStrongPassword = (password) => {
  if (!password || password.length < 8) return false;
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password);
  return hasUpper && hasLower && hasNumber && hasSpecial;
};

const generateToken = (user) => {
  return jwt.sign(
    {
      id: user._id,
      email: user.email,
      role: user.role,
      username: user.username
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
};

// ─── POST /api/auth/signup ──────────────────────────────────────────────────
// Creates account with isVerified=false. Does NOT issue a JWT.
// The user must complete Google verification before they can sign in.

router.post('/signup', async (req, res) => {
  try {
    const { email, password, role } = req.body;

    // Validate required fields
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Validate email domain
    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: `Only ${ALLOWED_DOMAIN} email addresses are allowed`
      });
    }

    // Validate password strength
    if (!isStrongPassword(password)) {
      return res.status(400).json({
        success: false,
        message:
          'Password must be at least 8 characters and include an uppercase letter, a lowercase letter, a number, and a special character'
      });
    }

    // Check for existing user
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      // If user exists but is not verified, allow re-verification
      if (!existingUser.isVerified) {
        return res.status(200).json({
          success: true,
          pendingVerification: true,
          email: existingUser.email,
          message: 'Account already exists but is not verified. Please verify with Google.'
        });
      }
      return res.status(409).json({
        success: false,
        message: 'An account with this email already exists'
      });
    }

    // Extract username from email prefix
    const username = email.split('@')[0].toLowerCase();

    // Create user with isVerified=false
    const user = await User.create({
      username,
      email: email.toLowerCase(),
      password,
      role: role === 'teacher' ? 'teacher' : 'student',
      isVerified: false
    });

    // Return pending verification — no JWT issued
    res.status(201).json({
      success: true,
      pendingVerification: true,
      email: user.email,
      message: 'Account created! Please verify your identity with Google.'
    });
  } catch (err) {
    console.error('Signup Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── POST /api/auth/signin ──────────────────────────────────────────────────

router.post('/signin', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: `Only ${ALLOWED_DOMAIN} email addresses are allowed`
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'No account found with this email. Please sign up first.'
      });
    }

    // Block unverified teachers from signing in (students are auto-verified upon login)
    if (user.role === 'student' && !user.isVerified) {
      user.isVerified = true;
      await user.save();
    } else if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        code: 'UNVERIFIED',
        email: user.email,
        message: 'Your account has not been verified yet. Please verify with Google.'
      });
    }

    // If user signed up with Google only (no password set)
    if (!user.password) {
      return res.status(401).json({
        success: false,
        message:
          'This account was created with Google Sign-In. Please use the "Sign in with Google" button.'
      });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    const token = generateToken(user);

    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error('Signin Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── GET /api/auth/google ───────────────────────────────────────────────────
// Direct Google Sign-In (for already verified users or first-time Google users)

router.get('/google', (req, res, next) => {
  // Store selected role in session so the Passport callback can read it
  req.session.authRole = req.query.role || 'student';
  // Clear any pending verification flag for this flow
  req.session.pendingVerifyEmail = null;

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

// ─── GET /api/auth/google/verify ────────────────────────────────────────────
// Verification flow: user must prove they own the email they signed up with

router.get('/google/verify', (req, res, next) => {
  const email = req.query.email;

  if (!email || !isValidEmail(email)) {
    return res.redirect('/verify.html?error=invalid_email');
  }

  // Store the email to verify against after Google callback
  req.session.pendingVerifyEmail = email.toLowerCase();

  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

// ─── GET /api/auth/google/callback ──────────────────────────────────────────

router.get(
  '/google/callback',
  passport.authenticate('google', {
    failureRedirect: '/signin.html?error=google_auth_failed'
  }),
  async (req, res) => {
    try {
      const pendingEmail = req.session.pendingVerifyEmail;

      if (pendingEmail) {
        // This is a VERIFICATION flow
        const googleEmail = req.user.email.toLowerCase();

        if (googleEmail !== pendingEmail) {
          // Mismatch — the Google account email doesn't match the signup email
          req.session.pendingVerifyEmail = null;
          return res.redirect(
            `/verify.html?email=${encodeURIComponent(pendingEmail)}&error=email_mismatch`
          );
        }

        // Match! Verify the user
        const user = await User.findOneAndUpdate(
          { email: pendingEmail },
          {
            $set: {
              isVerified: true,
              googleId: req.user.googleId || req.user._id,
              displayName:
                req.user.displayName || req.user.username || pendingEmail.split('@')[0]
            }
          },
          { new: true, runValidators: true }
        );
        if (user) {
          console.log(`✅ Verified ${user.email} — isVerified is now:`, user.isVerified);

          // Clear session flag
          req.session.pendingVerifyEmail = null;

          // Issue JWT and redirect to dashboard
          const token = generateToken(user);
          const dashboard = user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard';
          return res.redirect(`/${dashboard}.html?token=${token}`);
        }

        // User somehow doesn't exist (edge case)
        req.session.pendingVerifyEmail = null;
        return res.redirect('/signup.html?error=user_not_found');
      }

      // Normal Google Sign-In flow (not verification)
      if (req.user && req.user.role === 'student' && !req.user.isVerified) {
        await User.findByIdAndUpdate(req.user._id || req.user.id, { $set: { isVerified: true } });
        req.user.isVerified = true;
      }
      const token = generateToken(req.user);
      const dashboard = req.user.role === 'teacher' ? 'teacher-dashboard' : 'student-dashboard';
      res.redirect(`/${dashboard}.html?token=${token}`);
    } catch (err) {
      console.error('Google Callback Error:', err);
      return res.redirect('/signin.html?error=server_error');
    }
  }
);

// ─── GET /api/auth/me  (protected) ─────────────────────────────────────────

router.get('/me', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    if (user.role === 'student' && !user.isVerified) {
      user.isVerified = true;
      await user.save();
    }
    res.json({ success: true, user });
  } catch (err) {
    console.error('Me Error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
