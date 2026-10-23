/**
 * Teacher API Routes
 * All routes require a verified teacher JWT.
 *
 * Mounted at: /api/teacher
 *
 * Courses:
 *   GET    /courses                       – list teacher's courses
 *   POST   /courses                       – create a course
 *   GET    /courses/:courseId             – get one course + enrolled students
 *   PATCH  /courses/:courseId             – update title/description/semester
 *   DELETE /courses/:courseId             – soft-delete (deactivate) a course
 *   POST   /courses/:courseId/enroll      – bulk-enroll students by email list
 *   DELETE /courses/:courseId/enroll/:studentId – remove one student
 *
 * Sessions:
 *   GET    /courses/:courseId/sessions    – list sessions for a course
 *   POST   /courses/:courseId/sessions    – create a session
 *   PATCH  /sessions/:sessionId/open      – open attendance
 *   PATCH  /sessions/:sessionId/close     – close attendance
 *   GET    /sessions/:sessionId/roster    – full roster + attendance status
 *
 * Attendance (manual marking / correction):
 *   POST   /sessions/:sessionId/attendance        – mark/correct one student
 *
 * Dashboard summary:
 *   GET    /dashboard                     – aggregate stats for all courses
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { protect, requireRole, verifyFromDB } = require('../middleware/auth');
const User = require('../models/User');
const Course = require('../models/Course');
const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const { isValidCoordinate, isValidRadius } = require('../config/geofence');
const { generateSessionSecret, generateDynamicQrPayload, generateQrDataUrl } = require('../config/dynamicQr');

// All teacher routes: must be authenticated AND be a teacher (server-side check)
router.use(protect, requireRole('teacher'));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Ensure the course belongs to the authenticated teacher.
 * Returns the Course document or sends 403/404.
 */
async function getOwnCourse(req, res, courseId) {
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    res.status(400).json({ success: false, message: 'Invalid course ID' });
    return null;
  }
  const course = await Course.findById(courseId);
  if (!course) {
    res.status(404).json({ success: false, message: 'Course not found' });
    return null;
  }
  if (course.teacherId.toString() !== req.user.id) {
    res.status(403).json({ success: false, message: 'You are not authorised to access this course' });
    return null;
  }
  return course;
}

/**
 * Ensure the session belongs to the authenticated teacher.
 */
async function getOwnSession(req, res, sessionId) {
  if (!mongoose.Types.ObjectId.isValid(sessionId)) {
    res.status(400).json({ success: false, message: 'Invalid session ID' });
    return null;
  }
  const session = await AttendanceSession.findById(sessionId);
  if (!session) {
    res.status(404).json({ success: false, message: 'Session not found' });
    return null;
  }
  if (session.teacherId.toString() !== req.user.id) {
    res.status(403).json({ success: false, message: 'You are not authorised to access this session' });
    return null;
  }
  return session;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

router.get('/dashboard', async (req, res) => {
  try {
    const courses = await Course.find({ teacherId: req.user.id, isActive: true })
      .select('code title semester enrolledStudents createdAt')
      .lean();

    const courseIds = courses.map((c) => c._id);

    // Active open sessions across all teacher courses
    const openSessions = await AttendanceSession.find({
      teacherId: req.user.id,
      status: 'open'
    })
      .select('courseId label openedAt status')
      .lean();

    // Recent closed sessions (last 5)
    const recentSessions = await AttendanceSession.find({
      teacherId: req.user.id,
      status: 'closed'
    })
      .sort({ closedAt: -1 })
      .limit(5)
      .select('courseId label closedAt status')
      .lean();

    // Pending-review attendance records across all courses
    const pendingCount = await AttendanceRecord.countDocuments({
      teacherId: req.user.id,
      status: 'pending'
    });

    // Enrich sessions with course codes
    const courseMap = {};
    courses.forEach((c) => { courseMap[c._id.toString()] = c; });

    const enrichSession = (s) => ({
      ...s,
      courseCode: courseMap[s.courseId?.toString()]?.code || '',
      courseTitle: courseMap[s.courseId?.toString()]?.title || ''
    });

    res.json({
      success: true,
      totalCourses: courses.length,
      totalStudents: courses.reduce((sum, c) => sum + (c.enrolledStudents?.length || 0), 0),
      openSessions: openSessions.map(enrichSession),
      recentSessions: recentSessions.map(enrichSession),
      pendingReviewCount: pendingCount,
      courses: courses.map((c) => ({
        _id: c._id,
        code: c.code,
        title: c.title,
        semester: c.semester,
        studentCount: c.enrolledStudents?.length || 0
      }))
    });
  } catch (err) {
    console.error('Teacher dashboard error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Courses ──────────────────────────────────────────────────────────────────

// List teacher's courses
router.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find({ teacherId: req.user.id })
      .select('code title semester isActive enrolledStudents createdAt')
      .lean();
    res.json({
      success: true,
      courses: courses.map((c) => ({
        ...c,
        studentCount: c.enrolledStudents?.length || 0,
        enrolledStudents: undefined // don't send full array in list view
      }))
    });
  } catch (err) {
    console.error('List courses error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create a course
router.post('/courses', verifyFromDB, async (req, res) => {
  try {
    const { code, title, description, semester } = req.body;
    if (!code || !title) {
      return res.status(400).json({ success: false, message: 'Course code and title are required' });
    }
    // Prevent duplicate course code for this teacher
    const existing = await Course.findOne({
      code: code.trim().toUpperCase(),
      teacherId: req.user.id
    });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: `You already have a course with code ${code.trim().toUpperCase()}`
      });
    }
    const course = await Course.create({
      code: code.trim().toUpperCase(),
      title: title.trim(),
      description: description || '',
      semester: semester || '',
      teacherId: req.user.id
    });
    res.status(201).json({ success: true, course });
  } catch (err) {
    console.error('Create course error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get one course with enrolled student details
router.get('/courses/:courseId', async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    // Populate enrolled students (select safe fields only)
    const students = await User.find({
      _id: { $in: course.enrolledStudents },
      isVerified: true
    }).select('username email').lean();

    res.json({ success: true, course: { ...course.toObject(), students } });
  } catch (err) {
    console.error('Get course error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Update course metadata
router.patch('/courses/:courseId', verifyFromDB, async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    const { title, description, semester } = req.body;
    if (title) course.title = title.trim();
    if (description !== undefined) course.description = description;
    if (semester !== undefined) course.semester = semester;
    await course.save();

    res.json({ success: true, course });
  } catch (err) {
    console.error('Update course error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Soft-delete (deactivate) a course
router.delete('/courses/:courseId', verifyFromDB, async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    course.isActive = false;
    await course.save();
    res.json({ success: true, message: 'Course deactivated' });
  } catch (err) {
    console.error('Delete course error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Enrollment ───────────────────────────────────────────────────────────────

/**
 * POST /courses/:courseId/enroll
 * Body: { emails: ["a@iiitdwd.ac.in", "b@iiitdwd.ac.in"] }
 * Resolves each email to a verified student account.
 * Returns a breakdown: enrolled, alreadyEnrolled, notFound.
 */
router.post('/courses/:courseId/enroll', verifyFromDB, async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    const { emails } = req.body;
    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({ success: false, message: 'Provide a non-empty array of emails' });
    }
    if (emails.length > 300) {
      return res.status(400).json({ success: false, message: 'Maximum 300 emails per request' });
    }

    const normalised = emails.map((e) => String(e).trim().toLowerCase());
    const invalid = normalised.filter((e) => !e.endsWith('@iiitdwd.ac.in'));
    if (invalid.length) {
      return res.status(400).json({
        success: false,
        message: 'All emails must end with @iiitdwd.ac.in',
        invalid
      });
    }

    // Find registered student accounts for these emails
    const users = await User.find({
      email: { $in: normalised },
      role: 'student'
    }).select('_id email username isVerified').lean();

    const userMap = {};
    users.forEach((u) => { userMap[u.email] = u; });

    const alreadyEnrolled = [];
    const enrolled = [];
    const notFound = [];

    const existingSet = new Set(course.enrolledStudents.map((id) => id.toString()));

    for (const email of normalised) {
      const user = userMap[email];
      if (!user) {
        notFound.push(email);
      } else if (existingSet.has(user._id.toString())) {
        alreadyEnrolled.push({ email, username: user.username });
      } else {
        enrolled.push(user._id);
        alreadyEnrolled.push = alreadyEnrolled.push; // no-op to keep ref
      }
    }

    // Separately calculate truly newly enrolled
    const newlyEnrolled = [];
    for (const email of normalised) {
      const user = userMap[email];
      if (user && !existingSet.has(user._id.toString())) {
        newlyEnrolled.push({ id: user._id, email, username: user.username });
        course.enrolledStudents.push(user._id);
        existingSet.add(user._id.toString());
      }
    }

    if (newlyEnrolled.length) {
      await course.save();
    }

    res.json({
      success: true,
      enrolled: newlyEnrolled,
      alreadyEnrolled: users
        .filter((u) => existingSet.has(u._id.toString()) && !newlyEnrolled.find((n) => n.id.toString() === u._id.toString()))
        .map((u) => ({ email: u.email, username: u.username })),
      notFound,
      totalEnrolled: course.enrolledStudents.length
    });
  } catch (err) {
    console.error('Enroll students error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Remove one student from a course
router.delete('/courses/:courseId/enroll/:studentId', verifyFromDB, async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    if (!mongoose.Types.ObjectId.isValid(req.params.studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID' });
    }

    const before = course.enrolledStudents.length;
    course.enrolledStudents = course.enrolledStudents.filter(
      (id) => id.toString() !== req.params.studentId
    );

    if (course.enrolledStudents.length === before) {
      return res.status(404).json({ success: false, message: 'Student not enrolled in this course' });
    }

    await course.save();
    res.json({ success: true, message: 'Student removed from course' });
  } catch (err) {
    console.error('Remove student error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Attendance Sessions ──────────────────────────────────────────────────────

// List sessions for a course
router.get('/courses/:courseId/sessions', async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    const sessions = await AttendanceSession.find({ courseId: course._id })
      .sort({ createdAt: -1 })
      .lean();

    // Annotate each session with a summary count
    const sessionIds = sessions.map((s) => s._id);
    const records = await AttendanceRecord.aggregate([
      { $match: { sessionId: { $in: sessionIds } } },
      { $group: { _id: { sessionId: '$sessionId', status: '$status' }, count: { $sum: 1 } } }
    ]);

    const counts = {};
    records.forEach(({ _id, count }) => {
      const key = _id.sessionId.toString();
      if (!counts[key]) counts[key] = {};
      counts[key][_id.status] = count;
    });

    const enriched = sessions.map((s) => ({
      ...s,
      presentCount: counts[s._id.toString()]?.present || 0,
      absentCount: counts[s._id.toString()]?.absent || 0,
      pendingCount: counts[s._id.toString()]?.pending || 0
    }));

    res.json({ success: true, sessions: enriched });
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Create a session
router.post('/courses/:courseId/sessions', verifyFromDB, async (req, res) => {
  try {
    const course = await getOwnCourse(req, res, req.params.courseId);
    if (!course) return;

    const { label, scheduledAt } = req.body;

    const session = await AttendanceSession.create({
      courseId: course._id,
      teacherId: req.user.id,
      label: label || '',
      scheduledAt: scheduledAt || null,
      status: 'draft'
    });

    res.status(201).json({ success: true, session });
  } catch (err) {
    console.error('Create session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Open attendance for a session with location confirmation and QR secret initialization
router.patch('/sessions/:sessionId/open', verifyFromDB, async (req, res) => {
  try {
    const session = await getOwnSession(req, res, req.params.sessionId);
    if (!session) return;

    if (session.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Session is already closed and cannot be reopened' });
    }
    if (session.status === 'open') {
      return res.status(400).json({ success: false, message: 'Session is already open' });
    }

    const { latitude, longitude, radiusMeters } = req.body || {};

    // Check if location was provided now or already saved on session
    const targetLat = latitude !== undefined ? latitude : session.location?.latitude;
    const targetLon = longitude !== undefined ? longitude : session.location?.longitude;
    const targetRadius = radiusMeters !== undefined ? radiusMeters : (session.location?.radiusMeters || 50);

    if (!isValidCoordinate(targetLat, targetLon)) {
      return res.status(400).json({
        success: false,
        message: 'Valid classroom latitude (-90 to 90) and longitude (-180 to 180) are required to open attendance'
      });
    }

    if (!isValidRadius(targetRadius)) {
      return res.status(400).json({
        success: false,
        message: 'Valid positive geofence radius in meters (max 500m) is required'
      });
    }

    session.location = {
      latitude: Number(targetLat),
      longitude: Number(targetLon),
      radiusMeters: Number(targetRadius)
    };

    // Generate secure server-side QR secret
    session.qrSecret = generateSessionSecret();
    session.qrEnabled = true;
    session.status = 'open';
    session.openedAt = new Date();
    await session.save();

    // Convert to object and ensure qrSecret is omitted
    const sessionObj = session.toObject();
    delete sessionObj.qrSecret;

    res.json({ success: true, session: sessionObj });
  } catch (err) {
    console.error('Open session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /sessions/:sessionId/qr-token
// Generates fresh HMAC-SHA256 dynamic QR payload for the active time window
router.get('/sessions/:sessionId/qr-token', verifyFromDB, async (req, res) => {
  try {
    // Need qrSecret which is select: false by default
    if (!mongoose.Types.ObjectId.isValid(req.params.sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session ID' });
    }
    const session = await AttendanceSession.findById(req.params.sessionId).select('+qrSecret');
    if (!session) {
      return res.status(404).json({ success: false, message: 'Session not found' });
    }
    if (session.teacherId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'You are not authorised to access this session' });
    }
    if (session.status !== 'open') {
      return res.status(400).json({ success: false, message: 'Session is not open' });
    }
    if (!session.qrEnabled || !session.qrSecret) {
      return res.status(400).json({ success: false, message: 'QR attendance is not enabled for this session' });
    }

    const qrData = generateDynamicQrPayload(session._id, session.qrSecret);
    const qrDataUrl = await generateQrDataUrl(qrData.payload);
    res.json({
      success: true,
      sessionId: session._id,
      payload: qrData.payload,
      qrDataUrl,
      timeWindow: qrData.timeWindow,
      expiresAt: qrData.expiresAt,
      remainingSeconds: qrData.remainingSeconds,
      windowDurationSeconds: qrData.windowDurationSeconds
    });
  } catch (err) {
    console.error('QR token error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Close attendance — marks all un-attempted enrolled students as absent
router.patch('/sessions/:sessionId/close', verifyFromDB, async (req, res) => {
  try {
    const session = await getOwnSession(req, res, req.params.sessionId);
    if (!session) return;

    if (session.status === 'closed') {
      return res.status(400).json({ success: false, message: 'Session is already closed' });
    }
    if (session.status === 'draft') {
      return res.status(400).json({ success: false, message: 'Session was never opened' });
    }

    // Fetch the course to get enrolled students
    const course = await Course.findById(session.courseId).select('enrolledStudents teacherId');
    if (!course) {
      return res.status(404).json({ success: false, message: 'Associated course not found' });
    }

    // Students who already have a record
    const existingRecords = await AttendanceRecord.find({
      sessionId: session._id
    }).select('studentId').lean();

    const recordedStudentIds = new Set(existingRecords.map((r) => r.studentId.toString()));

    // Students without a record → mark absent by default
    const absentStudents = course.enrolledStudents.filter(
      (id) => !recordedStudentIds.has(id.toString())
    );

    if (absentStudents.length > 0) {
      const absentDocs = absentStudents.map((studentId) => ({
        sessionId: session._id,
        courseId: session.courseId,
        studentId,
        teacherId: req.user.id,
        status: 'absent',
        decisionSource: 'absent_default',
        faceVerificationStatus: 'not_applicable'
      }));

      // Use insertMany with ordered:false to skip any race-condition duplicates
      try {
        await AttendanceRecord.insertMany(absentDocs, { ordered: false });
      } catch (bulkErr) {
        // Duplicate key errors (11000) are acceptable; others are not
        if (bulkErr.code !== 11000) throw bulkErr;
      }
    }

    session.status = 'closed';
    session.closedAt = new Date();
    session.qrEnabled = false;
    session.qrSecret = null;
    await session.save();

    // Return final summary
    const summary = await AttendanceRecord.aggregate([
      { $match: { sessionId: session._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    const counts = {};
    summary.forEach(({ _id, count }) => { counts[_id] = count; });

    res.json({
      success: true,
      session,
      summary: {
        present: counts.present || 0,
        absent: counts.absent || 0,
        pending: counts.pending || 0
      }
    });
  } catch (err) {
    console.error('Close session error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// Get full roster with attendance status for a session
router.get('/sessions/:sessionId/roster', async (req, res) => {
  try {
    const session = await getOwnSession(req, res, req.params.sessionId);
    if (!session) return;

    const course = await Course.findById(session.courseId)
      .select('enrolledStudents code title');
    if (!course) {
      return res.status(404).json({ success: false, message: 'Course not found' });
    }

    // Get student details for enrolled students
    const students = await User.find({
      _id: { $in: course.enrolledStudents }
    }).select('_id username email').lean();

    // Get all attendance records for this session
    const records = await AttendanceRecord.find({ sessionId: session._id }).lean();
    const recordMap = {};
    records.forEach((r) => { recordMap[r.studentId.toString()] = r; });

    const roster = students.map((student) => {
      const record = recordMap[student._id.toString()];
      return {
        student: { _id: student._id, username: student.username, email: student.email },
        attendanceStatus: record ? record.status : 'no_record',
        decisionSource: record ? record.decisionSource : null,
        faceVerificationStatus: record ? record.faceVerificationStatus : null,
        teacherNote: record ? record.teacherNote : '',
        attemptedAt: record ? record.attemptedAt : null,
        correctedAt: record ? record.correctedAt : null,
        recordId: record ? record._id : null
      };
    });

    res.json({
      success: true,
      session,
      course: { _id: course._id, code: course.code, title: course.title },
      roster,
      summary: {
        total: roster.length,
        present: roster.filter((r) => r.attendanceStatus === 'present').length,
        absent: roster.filter((r) => r.attendanceStatus === 'absent').length,
        pending: roster.filter((r) => r.attendanceStatus === 'pending').length,
        noRecord: roster.filter((r) => r.attendanceStatus === 'no_record').length
      }
    });
  } catch (err) {
    console.error('Roster error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// ─── Manual Attendance ────────────────────────────────────────────────────────

/**
 * POST /sessions/:sessionId/attendance
 * Body: { studentId, status: 'present'|'absent', note? }
 *
 * Teacher can mark or correct a student's attendance.
 * Creates a new record or updates an existing one.
 * Always persists the previous status in the audit trail.
 */
router.post('/sessions/:sessionId/attendance', verifyFromDB, async (req, res) => {
  try {
    const session = await getOwnSession(req, res, req.params.sessionId);
    if (!session) return;

    const { studentId, status, note } = req.body;

    if (!['present', 'absent'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Status must be "present" or "absent"' });
    }
    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return res.status(400).json({ success: false, message: 'Invalid student ID' });
    }

    // Confirm student is enrolled in this course
    const course = await Course.findById(session.courseId).select('enrolledStudents teacherId');
    const isEnrolled = course && course.enrolledStudents.some((id) => id.toString() === studentId);
    if (!isEnrolled) {
      return res.status(403).json({ success: false, message: 'Student is not enrolled in this course' });
    }

    // Confirm studentId is actually a verified student
    const student = await User.findById(studentId).select('role isVerified');
    if (!student || student.role !== 'student' || !student.isVerified) {
      return res.status(403).json({ success: false, message: 'Target user is not a verified student' });
    }

    const now = new Date();

    // Upsert attendance record
    const existing = await AttendanceRecord.findOne({
      sessionId: session._id,
      studentId
    });

    let record;
    if (existing) {
      // Correction path — preserve audit trail
      existing.previousStatus = existing.status;
      existing.status = status;
      existing.decisionSource = 'manual';
      existing.markedByTeacherId = req.user.id;
      existing.teacherNote = note || '';
      existing.correctedAt = now;
      record = await existing.save();
    } else {
      // New manual record
      record = await AttendanceRecord.create({
        sessionId: session._id,
        courseId: session.courseId,
        studentId,
        teacherId: session.teacherId,
        status,
        decisionSource: 'manual',
        markedByTeacherId: req.user.id,
        teacherNote: note || '',
        faceVerificationStatus: 'not_applicable',
        correctedAt: now
      });
    }

    res.json({ success: true, record });
  } catch (err) {
    console.error('Manual attendance error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;
