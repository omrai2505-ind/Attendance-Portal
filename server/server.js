require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const path = require('path');
const connectDB = require('./config/db');

// Connect to MongoDB
connectDB();

// Load Passport config
require('./config/passport');

const app = express();

// --------------- Middleware ---------------
const allowedOrigin = process.env.CLIENT_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
app.use(cors({
  origin: allowedOrigin,
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000, // 1 day
    secure: false                  // set true in production with HTTPS
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// --------------- Static Files ---------------
app.use(express.static(path.join(__dirname, '..', 'public')));

// --------------- API Routes ---------------
app.use('/api/auth', require('./routes/auth'));
app.use('/api/face-verification', require('./routes/face-verification'));
app.use('/api/teacher', require('./routes/teacher'));
app.use('/api/student', require('./routes/student'));

// --------------- Catch-all: serve HTML pages ---------------
// Let named HTML files be served; the wildcard handles React-style SPAs.
// We only fall back to index.html for non-API, non-asset requests.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// --------------- Start Server ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`\n  🚀  Server running at http://localhost:${PORT}`);
  console.log(`  📚  IIIT Dharwad Attendance Portal\n`);

  // Ensure AI Face Inference Engine (YuNet + SFace) is running
  try {
    const { ensureRunning } = require('./face-verification/inference-supervisor');
    ensureRunning().catch((err) => {
      console.warn('  ⚠️  Face inference auto-start check:', err.message);
    });
  } catch (err) {
    console.warn('  ⚠️  Could not initialize face inference supervisor:', err.message);
  }
});

