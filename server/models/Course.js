const mongoose = require('mongoose');

/**
 * Course Model
 * Represents a course managed by a teacher at IIIT Dharwad.
 * Students are enrolled by roll-number → userId mappings.
 */
const courseSchema = new mongoose.Schema(
  {
    // Course code e.g. "CS201"
    code: {
      type: String,
      required: [true, 'Course code is required'],
      trim: true,
      uppercase: true
    },
    // Full title e.g. "Data Structures & Algorithms"
    title: {
      type: String,
      required: [true, 'Course title is required'],
      trim: true
    },
    // Description / syllabus snippet
    description: {
      type: String,
      default: ''
    },
    // The teacher who owns this course
    teacherId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    // Enrolled students — array of User ObjectIds
    enrolledStudents: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    ],
    // Academic semester / batch label e.g. "2025-26 Sem 1"
    semester: {
      type: String,
      default: ''
    },
    // Whether the course is currently active
    isActive: {
      type: Boolean,
      default: true
    }
  },
  { timestamps: true }
);

// Ensure (code, teacherId) is unique so a teacher can't duplicate a course
courseSchema.index({ code: 1, teacherId: 1 }, { unique: true });

module.exports = mongoose.model('Course', courseSchema);
