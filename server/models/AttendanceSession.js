const mongoose = require('mongoose');

/**
 * AttendanceSession Model
 * A single class meeting created by a teacher for a course.
 * Status lifecycle: draft → open → closed
 */
const attendanceSessionSchema = new mongoose.Schema(
  {
    courseId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Course',
      required: true,
      index: true
    },
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    // Human-readable label e.g. "Lecture 12 – Sorting"
    label: {
      type: String,
      default: ''
    },
    // Scheduled date/time of the class (informational)
    scheduledAt: {
      type: Date,
      default: null
    },
    // 'draft' | 'open' | 'closed'
    status: {
      type: String,
      enum: ['draft', 'open', 'closed'],
      default: 'draft'
    },
    // Timestamp when attendance was opened
    openedAt: {
      type: Date,
      default: null
    },
    // Timestamp when attendance was closed
    closedAt: {
      type: Date,
      default: null
    },
    // Classroom GPS geofence configuration
    location: {
      latitude: {
        type: Number,
        min: -90,
        max: 90,
        default: null
      },
      longitude: {
        type: Number,
        min: -180,
        max: 180,
        default: null
      },
      radiusMeters: {
        type: Number,
        min: 1,
        max: 500,
        default: 50
      }
    },
    // High-entropy random secret for HMAC-SHA256 dynamic QR generation
    qrSecret: {
      type: String,
      select: false, // Never return to frontend
      default: null
    },
    // Explicit dynamic QR enablement flag
    qrEnabled: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model('AttendanceSession', attendanceSessionSchema);
