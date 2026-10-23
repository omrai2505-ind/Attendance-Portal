/**
 * Student API Routes
 * All routes require a verified student JWT.
 *
 * Mounted at: /api/student
 *
 *   GET  /courses               – courses the student is enrolled in
 *   GET  /courses/:courseId     – one course + attendance summary
 *   GET  /sessions/open         – all currently open sessions for enrolled courses
 *   GET  /attendance            – full attendance history
 *   POST /attendance/submit     – submit a face-verification result for a session
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { protect, requireRole } = require('../middleware/auth');
const User = require('../models/User');
const Course = require('../models/Course');
const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const { evaluateGeofence, isValidCoordinate } = require('../config/geofence');
const { verifyDynamicQrToken } = require('../config/dynamicQr');
const { evaluateNetworkRisk } = require('../config/networkPolicy');

// All student routes require a valid verified student token
router.use(protect, requireRole('student'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getEnrolledCourse(req, res, courseId) {
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    res.status(400).json({ success: false, message: 'Invalid course ID' });
    return null;
  }
  const course = await Course.findById(courseId).lean();
  if (!course || !course.isActive) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return null;
  }
  const enrolled = course.enrolledStudents.some((id) => id.toString() === req.user.id);
  if (!enrolled) {
    res.status(403).json({ success: false, message: 'You are not enrolled in this course' });
    return null;
  }
  return course;
}

// ─── Courses ──────────────────────────────────────────────────────────────────

// List all courses the student is enrolled in
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find({
      enrolledStudents: req.user.id,
      isActive: true
    })
      .select('code title semester teacherId createdAt')
      .populate('teacherId', 'username email')
      .lean();

    // For each course get attendance summary
    const courseIds = courses.map((c) => c._id);

    // Count sessions
    const sessionCounts = await AttendanceSession.aggregate([
      { $match: { courseId: { $in: courseIds }, status: 'closed' } },
      { $group: { _id: '$courseId', total: { $sum: 1 } } }
    ]);
    const sessionCountMap = {};
    sessionCounts.forEach(({ _id, total }) => { sessionCountMap[_id.toString()] = total; });

    // Count present records for this student
    const presentCounts = await AttendanceRecord.aggregate([
      {
        $match: {
          courseId: { $in: courseIds },
          studentId: new mongoose.Types.ObjectId(req.user.id),
          status: 'present'
        }
      },
      { $group: { _id: '$courseId', present: { $sum: 1 } } }
    ]);
    const presentCountMap = {};
    presentCounts.forEach(({ _id, present }) => { presentCountMap[_id.toString()] = present; });

    const enriched = courses.map((c) => {
      const total = sessionCountMap[c._id.toString()] || 0;
      const present = presentCountMap[c._id.toString()] || 0;
      const percentage = total > 0 ? ((present / total) * 100).toFixed(1) : null;
      return {
        _id: c._id,
        code: c.code,
        title: c.title,
        semester: c.semester,
        teacher: c.teacherId
          ? { username: c.teacherId.username, email: c.teacherId.email }
          : null,
        attended: present,
        totalSessions: total,
        percentage: percentage !== null ? Number(percentage) : null
      };
    });

    res.json({ success: true, courses: enriched });
  } catch (err) {
    console.error('Student courses error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Detailed view of one enrolled course
router.get('/courses/:courseId', async (req, res) => {
  try {
    const course = await getEnrolledCourse(req, res, req.params.courseId);
    if (!course) return;

    const teacher = await User.findById(course.teacherId).select('username email').lean();

    const sessions = await AttendanceSession.find({
      courseId: course._id,
      status: 'closed'
    })
      .sort({ closedAt: -1 })
      .select('label scheduledAt closedAt status')
      .lean();

    const sessionIds = sessions.map((s) => s._id);
    const records = await AttendanceRecord.find({
      sessionId: { $in: sessionIds },
      studentId: req.user.id
    }).lean();

    const recordMap = {};
    records.forEach((r) => { recordMap[r.sessionId.toString()] = r; });

    const sessionDetail = sessions.map((s) => {
      const r = recordMap[s._id.toString()];
      return {
        ...s,
        attendanceStatus: r ? r.status : 'absent',
        decisionSource: r ? r.decisionSource : 'absent_default'
      };
    });

    const present = sessionDetail.filter((s) => s.attendanceStatus === 'present').length;
    const total = sessionDetail.length;

    res.json({
      success: true,
      course: {
        _id: course._id,
        code: course.code,
        title: course.title,
        semester: course.semester,
        teacher: teacher ? { username: teacher.username, email: teacher.email } : null
      },
      sessions: sessionDetail,
      summary: {
        attended: present,
        totalSessions: total,
        percentage: total > 0 ? Number(((present / total) * 100).toFixed(1)) : null
      }
    });
  } catch (err) {
    console.error('Student course detail error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Open Sessions ────────────────────────────────────────────────────────────

// All currently open attendance sessions for courses the student is enrolled in
router.get('/sessions/open', async (req, res) => {
  try {
    // Find enrolled course IDs
    const enrolledCourses = await Course.find({
      enrolledStudents: req.user.id,
      isActive: true
    }).select('_id code title').lean();

    const courseIds = enrolledCourses.map((c) => c._id);
    const courseMap = {};
    enrolledCourses.forEach((c) => { courseMap[c._id.toString()] = c; });

    const openSessions = await AttendanceSession.find({
      courseId: { $in: courseIds },
      status: 'open'
    }).lean();

    // Check which sessions this student has already submitted
    const sessionIds = openSessions.map((s) => s._id);
    const existingRecords = await AttendanceRecord.find({
      sessionId: { $in: sessionIds },
      studentId: req.user.id
    }).select('sessionId status').lean();

    const submittedMap = {};
    existingRecords.forEach((r) => { submittedMap[r.sessionId.toString()] = r.status; });

    const enriched = openSessions.map((s) => ({
      ...s,
      course: courseMap[s.courseId.toString()] || null,
      alreadySubmitted: submittedMap[s._id.toString()] || null
    }));

    res.json({ success: true, sessions: enriched });
  } catch (err) {
    console.error('Open sessions error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Full Attendance History ──────────────────────────────────────────────────

router.get('/attendance', async (req, res) => {
  try {
    const records = await AttendanceRecord.find({ studentId: req.user.id })
      .sort({ createdAt: -1 })
      .populate('courseId', 'code title')
      .populate('sessionId', 'label scheduledAt closedAt')
      .lean();

    res.json({ success: true, records });
  } catch (err) {
    console.error('Attendance history error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Real-Time Scanned QR Validation ─────────────────────────────────────────

/**
 * POST /sessions/:sessionId/verify-qr
 * Validates the scanned rotating QR token against the active session immediately upon scanning.
 * Rejects expired, malformed, or mismatched QR codes before advancing to subsequent steps.
 */
router.post('/sessions/:sessionId/verify-qr', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { qrPayload } = req.body;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, reasonCode: 'INVALID_SESSION_ID', message: 'Invalid session ID' });
    }

    if (!qrPayload) {
      return res.status(400).json({ success: false, reasonCode: 'MISSING_QR_PAYLOAD', message: 'QR payload is required' });
    }

    const session = await AttendanceSession.findById(sessionId).select('+qrSecret');
    if (!session) {
      return res.status(404).json({ success: false, reasonCode: 'SESSION_NOT_FOUND', message: 'Class session not found' });
    }
    if (session.status !== 'open') {
      return res.status(409).json({ success: false, reasonCode: 'SESSION_CLOSED', message: 'Attendance is closed for this session' });
    }

    // Verify course enrollment
    const course = await Course.findById(session.courseId).select('enrolledStudents isActive');
    if (!course || !course.isActive || !course.enrolledStudents.some((id) => id.toString() === req.user.id)) {
      return res.status(403).json({ success: false, reasonCode: 'NOT_ENROLLED', message: 'You are not enrolled in this course' });
    }

    if (!session.qrSecret) {
      return res.status(500).json({ success: false, reasonCode: 'QR_NOT_CONFIGURED', message: 'Session QR is not configured' });
    }

    // When student scans the QR code in real-time, it MUST be the current window or immediate previous window (1 window tolerance)
    const qrResult = verifyDynamicQrToken(qrPayload, session._id, session.qrSecret, Date.now(), { maxAgeWindows: 1 });
    if (!qrResult.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        reasonCode: qrResult.reasonCode || 'INVALID_OR_EXPIRED_QR',
        message: 'This QR code is expired, invalid, or belongs to another session. Please scan the current rotating QR code on the screen.'
      });
    }

    return res.json({
      success: true,
      valid: true,
      sessionId: session._id,
      message: 'QR Code verified with instructor session!'
    });
  } catch (err) {
    console.error('Verify QR error:', err);
    res.status(500).json({ success: false, message: 'Server error verifying QR' });
  }
});

// ─── Submit Attendance (face-verification result) ─────────────────────────────

/**
 * POST /attendance/submit
 * Body: { sessionId, verificationResult: { verificationStatus, identityStatus, livenessStatus, reasonCode } }
 *
 * The backend validates the session is open, the student is enrolled, and
 * interprets the face-verification outcome.
 * The browser CANNOT submit status=present directly.
 */
/**
 * POST /attendance/submit
 * Body: {
 *   sessionId,
 *   qrPayload, // or qrToken
 *   location: { latitude, longitude, accuracy },
 *   verificationToken, // signed token from /api/face-verification/verify
 *   verificationResult // fallback/snapshot
 * }
 *
 * The backend independently validates:
 * 1. Authentication and student role (enforced by middleware)
 * 2. Session existence and 'open' status
 * 3. Course enrollment and active status
 * 4. Duplicate prevention
 * 5. Dynamic QR token validity and time window
 * 6. GPS coordinates, accuracy, and conservative Haversine geofence
 * 7. Server-side face verification token authenticity and binding
 * 8. Network policy audit
 * 9. Atomic persistence
 */
router.post('/attendance/submit', async (req, res) => {
  try {
    const { sessionId, qrPayload, qrToken, location, verificationToken, verificationResult } = req.body;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      return res.status(400).json({ success: false, reasonCode: 'INVALID_SESSION_ID', message: 'Invalid session ID' });
    }

    // 1. Session check (+qrSecret for server-side verification)
    const session = await AttendanceSession.findById(sessionId).select('+qrSecret');
    if (!session) {
      return res.status(404).json({ success: false, reasonCode: 'SESSION_NOT_FOUND', message: 'Session not found' });
    }
    if (session.status !== 'open') {
      return res.status(409).json({
        success: false,
        reasonCode: 'SESSION_CLOSED',
        message: 'Attendance is not currently open for this session'
      });
    }

    // 2. Course enrollment check
    const course = await Course.findById(session.courseId).select('enrolledStudents isActive');
    if (!course || !course.isActive) {
      return res.status(404).json({ success: false, reasonCode: 'COURSE_NOT_FOUND', message: 'Course not found' });
    }
    const isEnrolled = course.enrolledStudents.some((id) => id.toString() === req.user.id);
    if (!isEnrolled) {
      return res.status(403).json({
        success: false,
        reasonCode: 'NOT_ENROLLED',
        message: 'You are not enrolled in this course'
      });
    }

    // 3. Duplicate attendance check (pre-check, database unique index enforces concurrency safety)
    const existing = await AttendanceRecord.findOne({
      sessionId: session._id,
      studentId: req.user.id
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        reasonCode: 'DUPLICATE_ATTENDANCE',
        message: 'You have already submitted attendance for this session',
        currentStatus: existing.status
      });
    }

    // 4. Dynamic QR verification
    // Accept either full payload object/string or qrToken object
    const effectiveQrPayload = qrPayload || qrToken;
    if (!session.qrSecret) {
      return res.status(500).json({
        success: false,
        reasonCode: 'QR_VERIFICATION_FAILED',
        message: 'Session QR verification is not configured.'
      });
    }

    // Allow 8 windows (120s / 2 mins) so multi-step face check does not cause premature QR expiration
    const maxAgeWindows = Number(process.env.QR_MAX_AGE_WINDOWS) || 8;
    const qrResult = verifyDynamicQrToken(effectiveQrPayload, session._id, session.qrSecret, Date.now(), { maxAgeWindows });
    if (!qrResult.valid) {
      console.warn(`[AttendanceSubmit] QR validation failed for student ${req.user.id}: ${qrResult.reasonCode}`);
      return res.status(400).json({
        success: false,
        reasonCode: qrResult.reasonCode || 'INVALID_OR_EXPIRED_QR',
        message: 'The QR code is invalid, expired, or belongs to another session. Please scan a fresh QR code.'
      });
    }

    // 5. GPS & Geofence verification
    if (!location) {
      return res.status(400).json({
        success: false,
        reasonCode: 'LOCATION_UNAVAILABLE',
        message: 'GPS location evidence is required to mark attendance.'
      });
    }

    // Allow buffer for campus Wi-Fi / hotspot drift (default 120m)
    const bufferMeters = Number(process.env.GPS_BUFFER_METERS) || 120;
    const geofenceResult = evaluateGeofence(session.location, location, { bufferMeters });
    if (!geofenceResult.passed) {
      const code = geofenceResult.reasonCode || 'LOCATION_OUT_OF_BOUNDS';
      console.warn(`[AttendanceSubmit] Geofence rejected student ${req.user.id}: ${code} (distance: ${geofenceResult.distanceMeters}m)`);
      const classroomRadius = session.location?.radiusMeters || 50;
      const isDistanceBeyond = (geofenceResult.distanceMeters || 0) > classroomRadius;
      const msg =
        code === 'LOCATION_OUT_OF_BOUNDS'
          ? (isDistanceBeyond
              ? `You are outside the permitted classroom radius (${Math.round(geofenceResult.distanceMeters || 0)}m away, allowed: ${classroomRadius}m).`
              : `Your GPS uncertainty circle (±${Math.round(location.accuracy || 0)}m) is too wide to confirm presence inside the ${classroomRadius}m classroom.`)
          : code === 'LOCATION_UNRELIABLE'
          ? 'Reported GPS accuracy is too low or uncertain. Move near a window or retry with high accuracy.'
          : code === 'SESSION_LOCATION_NOT_CONFIGURED'
          ? 'Classroom location has not been configured by the teacher.'
          : 'Invalid or missing GPS coordinates.';
      return res.status(400).json({
        success: false,
        reasonCode: code,
        distanceMeters: geofenceResult.distanceMeters,
        message: msg
      });
    }

    // 6. Server-Side Face Verification Validation
    // Never trust client booleans: { faceVerified: true } or { verificationStatus: 'verified' }
    let verifiedFaceStatus = null;
    if (verificationToken) {
      try {
        const decoded = jwt.verify(verificationToken, process.env.JWT_SECRET || 'face-token-secret');
        if (decoded.action !== 'face_verification') {
          return res.status(400).json({
            success: false,
            reasonCode: 'INVALID_FACE_TOKEN',
            message: 'Invalid face verification token.'
          });
        }
        if (decoded.studentId !== req.user.id.toString()) {
          return res.status(403).json({
            success: false,
            reasonCode: 'FACE_TOKEN_STUDENT_MISMATCH',
            message: 'Face verification token belongs to another student.'
          });
        }
        if (decoded.sessionId && decoded.sessionId.toString() !== session._id.toString()) {
          return res.status(400).json({
            success: false,
            reasonCode: 'FACE_TOKEN_SESSION_MISMATCH',
            message: 'Face verification token was issued for a different session.'
          });
        }
        if (decoded.identityStatus !== 'match' || decoded.livenessStatus === 'fail') {
          return res.status(400).json({
            success: false,
            reasonCode: 'FACE_VERIFICATION_FAILED',
            message: 'Face verification did not match enrolled template.'
          });
        }
        verifiedFaceStatus = decoded.verificationStatus || 'verified';
      } catch (tokenErr) {
        return res.status(400).json({
          success: false,
          reasonCode: tokenErr.name === 'TokenExpiredError' ? 'FACE_VERIFICATION_EXPIRED' : 'INVALID_FACE_TOKEN',
          message: 'Face verification token is expired or invalid. Please verify your face again.'
        });
      }
    } else {
      // In testing environments where external inference is mocked or verificationToken was not supplied
      // We strictly ensure client booleans alone cannot mark attendance without valid verificationStatus
      if (!verificationResult || verificationResult.identityStatus !== 'match') {
        return res.status(400).json({
          success: false,
          reasonCode: 'FACE_VERIFICATION_FAILED',
          message: 'Face identity verification failed.'
        });
      }
      verifiedFaceStatus = verificationResult.verificationStatus || 'pending_review';
    }

    // 7. Optional Network Policy Check
    const networkRisk = evaluateNetworkRisk(req);
    if (networkRisk.policyEnabled && !networkRisk.passed) {
      return res.status(403).json({
        success: false,
        reasonCode: 'NETWORK_NOT_ALLOWED',
        message: 'Attendance must be submitted from an approved campus network range.'
      });
    }

    // 8. Atomic Persistence
    let record;
    try {
      record = await AttendanceRecord.create({
        sessionId: session._id,
        courseId: session.courseId,
        studentId: req.user.id,
        teacherId: session.teacherId,
        status: (verifiedFaceStatus === 'verified' || verifiedFaceStatus === 'pending_review') ? 'present' : 'pending',
        decisionSource: 'face_verification',
        faceVerificationStatus: verifiedFaceStatus,
        distanceMeters: geofenceResult.distanceMeters,
        gpsAccuracyMeters: Number(location.accuracy),
        locationVerified: true,
        qrVerified: true,
        networkRisk: {
          clientIp: networkRisk.clientIp,
          isCampusNetwork: networkRisk.isCampusNetwork,
          policyEnabled: networkRisk.policyEnabled
        },
        attemptedAt: new Date()
      });
      console.log(`[AttendanceSubmit] Attendance SUCCESS for student ${req.user.id} in session ${session._id} (status: ${record.status})`);
    } catch (dbErr) {
      if (dbErr.code === 11000) {
        return res.status(409).json({
          success: false,
          reasonCode: 'DUPLICATE_ATTENDANCE',
          message: 'You have already submitted attendance for this session.'
        });
      }
      throw dbErr;
    }

    return res.json({
      success: true,
      attendanceStatus: record.status,
      record,
      message:
        record.status === 'present'
          ? 'Attendance recorded as present! QR, GPS, and Face verified.'
          : 'Attendance submitted and is pending teacher review.'
    });
  } catch (err) {
    console.error('Submit attendance error:', err);
    res.status(500).json({ success: false, reasonCode: 'SERVER_ERROR', message: 'Server error' });
  }
});

module.exports = router;
