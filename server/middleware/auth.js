const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * protect – verify JWT from Authorization: Bearer <token>
 * Attaches decoded payload to req.user.
 * Does NOT query the database — role comes from the signed token.
 */
const protect = (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized — no token provided'
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized — token is invalid or expired'
    });
  }
};

/**
 * requireRole(...roles) – server-side role gate after protect.
 * The role in req.user comes from the signed JWT and the DB record at
 * token-generation time; it is NOT supplied by the browser at request time.
 *
 * Usage: router.get('/teacher-only', protect, requireRole('teacher'), handler)
 */
const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: `Access denied — requires role: ${roles.join(' or ')}`
    });
  }
  next();
};

/**
 * verifyFromDB – re-fetches the user from MongoDB to confirm the account
 * still exists, is still verified, and that the stored role matches.
 * Use on sensitive write operations where stale-token attacks matter.
 */
const verifyFromDB = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('role isVerified');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Account not found. Please sign in again.'
      });
    }
    if (!user.isVerified) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending verification. Please verify your institutional email or contact admin.'
      });
    }
    // Override token role with authoritative DB role to prevent role-claim attacks
    req.user.role = user.role;
    next();
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { protect, requireRole, verifyFromDB };
