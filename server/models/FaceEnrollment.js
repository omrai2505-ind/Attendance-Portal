const mongoose = require('mongoose');

const faceEnrollmentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true
    },
    iv: { type: String, required: true, select: false },
    authTag: { type: String, required: true, select: false },
    ciphertext: { type: String, required: true, select: false },
    modelVersion: { type: String, required: true },
    consentedAt: { type: Date, required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model('FaceEnrollment', faceEnrollmentSchema);
