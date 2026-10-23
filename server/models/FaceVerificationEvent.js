const mongoose = require('mongoose');

const faceVerificationEventSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  action: {
    type: String,
    enum: ['enrollment', 'verification', 'deletion'],
    required: true
  },
  identityStatus: {
    type: String,
    enum: ['match', 'no_match', 'inconclusive', 'not_applicable'],
    required: true
  },
  livenessStatus: {
    type: String,
    enum: ['pass', 'fail', 'inconclusive', 'not_applicable'],
    required: true
  },
  verificationStatus: {
    type: String,
    enum: ['verified', 'not_verified', 'pending_review', 'not_applicable'],
    default: 'not_applicable'
  },
  reasonCode: { type: String, default: null },
  modelVersion: { type: String, default: null },
  createdAt: { type: Date, default: Date.now, immutable: true }
});

module.exports = mongoose.model('FaceVerificationEvent', faceVerificationEventSchema);
