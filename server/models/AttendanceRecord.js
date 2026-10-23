const mongoose = require('mongoose');

/**
 * AttendanceRecord Model
 * A single student's attendance decision for one session.
 *
 * decisionSource:
 *   'face_verification' – set automatically by the backend after a
 *                          successful face-verification result
 *   'manual'            – set or corrected by the authorised teacher
 *   'absent_default'    – set by system when session closes without
 *                          a student attempt
 *
 * status:
 *   'present'  – student attended (verified or manually marked)
 *   'absent'   – student did not attend (or rejected)
 *   'pending'  – verification attempt exists but needs teacher review
 */
const attendanceRecordSchema = new mongoose.Schema(
  {
    sessionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'AttendanceSession',
      required: true,
      index: true
    },
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    // The teacher who owns the session's course
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    // Final attendance status
    status: {
      type: String,
      enum: ['present', 'absent', 'pending'],
      required: true
    },
    // Who/what set this record
    decisionSource: {
      type: String,
      enum: ['face_verification', 'manual', 'absent_default'],
      required: true
    },
    // Face verification outcome snapshot (may be null for manual records)
    faceVerificationStatus: {
      type: String,
      enum: ['verified', 'not_verified', 'pending_review', 'not_applicable', null],
      default: null
    },
    // Teacher who performed manual operation (if applicable)
    markedByTeacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null
    },
    // Free-text reason for manual correction
    teacherNote: {
      type: String,
      default: ''
    },
    // Audit: what the status was before a correction
    previousStatus: {
      type: String,
      enum: ['present', 'absent', 'pending', null],
      default: null
    },
    // Timestamp of the student's verification attempt
    attemptedAt: {
      type: Date,
      default: null
    },
    // Timestamp of last teacher manual change
    correctedAt: {
      type: Date,
      default: null
    },
    // Verification Evidence & Auditability
    distanceMeters: {
      type: Number,
      default: null
    },
    gpsAccuracyMeters: {
      type: Number,
      default: null
    },
    locationVerified: {
      type: Boolean,
      default: false
    },
    qrVerified: {
      type: Boolean,
      default: false
    },
    networkRisk: {
      clientIp: { type: String, default: null },
      isCampusNetwork: { type: Boolean, default: null },
      policyEnabled: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

// One record per (session, student) — prevents duplicate records
attendanceRecordSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });

module.exports = mongoose.model('AttendanceRecord', attendanceRecordSchema);
