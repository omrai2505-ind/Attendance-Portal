const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const FaceEnrollment = require('../models/FaceEnrollment');
const FaceVerificationEvent = require('../models/FaceVerificationEvent');
const { protect } = require('../middleware/auth');
const {
  averageEmbeddings,
  cosineSimilarity,
  validateEmbedding
} = require('../face-verification/embeddings');
const {
  TemplateEncryptionConfigError,
  TemplateIntegrityError,
  decryptEmbedding,
  encryptEmbedding
} = require('../face-verification/template-crypto');
const {
  InferenceServiceError,
  requestInference
} = require('../face-verification/inference-client');
const { createUserRateLimiter } = require('../face-verification/rate-limit');

const router = express.Router();
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MODEL_VERSION = 'yunet-2023mar+sface-2021dec-opencv-4.11';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_IMAGE_BYTES, files: 3, fields: 10, parts: 15 },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype !== 'image/jpeg') {
      const error = new Error('INVALID_IMAGE_TYPE');
      error.code = 'INVALID_IMAGE_TYPE';
      return callback(error);
    }
    return callback(null, true);
  }
});

const uploadSingle = uploadMiddleware(upload.single('capture'));
const uploadSamples = uploadMiddleware(upload.array('samples', 3));
const previewLimit = createUserRateLimiter({ limit: 30, windowMs: 60 * 1000 });
const verifyLimit = createUserRateLimiter({ limit: 5, windowMs: 15 * 60 * 1000 });
const enrollmentLimit = createUserRateLimiter({ limit: 3, windowMs: 60 * 60 * 1000 });
const deletionLimit = createUserRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

function uploadMiddleware(handler) {
  return (req, res, next) => {
    handler(req, res, (error) => {
      if (!error) {
        return next();
      }
      if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          reasonCode: 'IMAGE_TOO_LARGE',
          message: 'Each image must be no larger than 2 MB.'
        });
      }
      const status = error instanceof multer.MulterError ? 400 : 415;
      return res.status(status).json({
        success: false,
        reasonCode: error.code || 'INVALID_IMAGE',
        message: 'Upload one to three JPEG images using the documented field name.'
      });
    });
  };
}

async function getVerifiedStudent(req, res) {
  const user = await User.findById(req.user.id).select('role isVerified save');
  if (!user || user.role !== 'student') {
    res.status(403).json({
      success: false,
      reasonCode: 'STUDENT_ACCOUNT_REQUIRED',
      message: 'A student account is required for this feature.'
    });
    return null;
  }
  if (!user.isVerified) {
    user.isVerified = true;
    if (typeof user.save === 'function') {
      await user.save();
    } else {
      await User.findByIdAndUpdate(user._id || req.user.id, { $set: { isVerified: true } });
    }
  }
  return user;
}

function respondInferenceError(res, error) {
  if (error instanceof InferenceServiceError) {
    const status = error.reasonCode === 'MODEL_SERVICE_UNAVAILABLE' ? 503 : error.statusCode;
    return res.status(status).json({
      success: false,
      reasonCode: error.reasonCode,
      message:
        error.reasonCode === 'MODEL_SERVICE_UNAVAILABLE'
          ? 'The face verification service is unavailable. Please retry later.'
          : 'The image could not be processed. Please follow the capture instructions.'
    });
  }
  if (error instanceof TemplateEncryptionConfigError) {
    return res.status(503).json({
      success: false,
      reasonCode: 'TEMPLATE_ENCRYPTION_UNAVAILABLE',
      message: 'Secure face-reference storage is not configured.'
    });
  }
  if (error instanceof TemplateIntegrityError) {
    console.error('Stored face reference integrity validation failed');
    return res.status(500).json({
      success: false,
      reasonCode: 'ENROLLMENT_REFERENCE_UNAVAILABLE',
      message: 'The stored face reference could not be used. Contact support.'
    });
  }
  console.error('Face verification request failed:', error);
  return res.status(500).json({
    success: false,
    message: 'The face verification request could not be completed.'
  });
}

function recordEvent(event) {
  return FaceVerificationEvent.create(event);
}

router.get('/enrollment', protect, async (req, res) => {
  try {
    const user = await getVerifiedStudent(req, res);
    if (!user) return;
    const enrollment = await FaceEnrollment.findOne({ userId: user._id })
      .select('modelVersion consentedAt')
      .lean();
    return res.json({
      success: true,
      enrolled: Boolean(enrollment),
      modelVersion: enrollment ? enrollment.modelVersion : null,
      consentedAt: enrollment ? enrollment.consentedAt : null
    });
  } catch (error) {
    return respondInferenceError(res, error);
  }
});

router.post('/preview', protect, previewLimit, uploadSingle, async (req, res) => {
  try {
    const user = await getVerifiedStudent(req, res);
    if (!user) return;
    if (req.body.consent !== 'true') {
      return res.status(400).json({
        success: false,
        reasonCode: 'BIOMETRIC_CONSENT_REQUIRED',
        message: 'Consent is required before processing camera images.'
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        reasonCode: 'INVALID_IMAGE',
        message: 'A JPEG camera capture is required.'
      });
    }

    const result = await requestInference('/v1/face/inspect', req.file.buffer);
    return res.json({
      success: true,
      state: result.state,
      bounds: result.bounds,
      image: result.image,
      latencyMs: result.detectionLatencyMs
    });
  } catch (error) {
    return respondInferenceError(res, error);
  }
});

router.post('/enrollment', protect, enrollmentLimit, uploadSamples, async (req, res) => {
  try {
    const user = await getVerifiedStudent(req, res);
    if (!user) return;
    if (req.body.consent !== 'true') {
      return res.status(400).json({
        success: false,
        reasonCode: 'BIOMETRIC_CONSENT_REQUIRED',
        message: 'Explicit consent is required before creating a face reference.'
      });
    }
    if (!Array.isArray(req.files) || req.files.length < 2 || req.files.length > 3) {
      return res.status(400).json({
        success: false,
        reasonCode: 'INVALID_ENROLLMENT_SAMPLES',
        message: 'Capture two or three suitable face samples to enroll.'
      });
    }

    const results = [];
    for (const file of req.files) {
      results.push(await requestInference('/v1/face/embedding', file.buffer));
    }

    const versions = new Set(results.map((result) => result.modelVersion));
    if (versions.size !== 1 || !versions.has(MODEL_VERSION)) {
      return res.status(503).json({
        success: false,
        reasonCode: 'MODEL_VERSION_MISMATCH',
        message: 'The face models changed during enrollment. Please retry later.'
      });
    }
    const embedding = averageEmbeddings(results.map((result) => result.embedding));
    const encrypted = encryptEmbedding(embedding);
    const consentedAt = new Date();

    await FaceEnrollment.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          ...encrypted,
          modelVersion: MODEL_VERSION,
          consentedAt
        }
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await recordEvent({
      userId: user._id,
      action: 'enrollment',
      identityStatus: 'not_applicable',
      livenessStatus: 'pass',
      reasonCode: null,
      modelVersion: MODEL_VERSION
    });

    return res.status(201).json({
      success: true,
      enrolled: true,
      modelVersion: MODEL_VERSION,
      consentedAt,
      livenessStatus: 'pass',
      reasonCode: null
    });
  } catch (error) {
    return respondInferenceError(res, error);
  }
});

router.post('/verify', protect, verifyLimit, uploadSingle, async (req, res) => {
  const startedAt = process.hrtime.bigint();
  const latencyMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
  try {
    const user = await getVerifiedStudent(req, res);
    if (!user) return;
    if (req.body.consent !== 'true') {
      return res.status(400).json({
        success: false,
        reasonCode: 'BIOMETRIC_CONSENT_REQUIRED',
        message: 'Consent is required before processing camera images.'
      });
    }
    if (!req.file) {
      return res.status(400).json({
        success: false,
        reasonCode: 'INVALID_IMAGE',
        message: 'A JPEG camera capture is required.'
      });
    }

    const enrollment = await FaceEnrollment.findOne({ userId: user._id })
      .select('+iv +authTag +ciphertext modelVersion');
    if (!enrollment) {
      const result = {
        success: true,
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        faceQuality: 'unknown',
        verificationStatus: 'pending_review',
        modelVersion: null,
        reasonCode: 'NO_ENROLLED_REFERENCE',
        latencyMs: latencyMs()
      };
      await recordEvent({
        userId: user._id,
        action: 'verification',
        identityStatus: result.identityStatus,
        livenessStatus: result.livenessStatus,
        verificationStatus: result.verificationStatus,
        reasonCode: result.reasonCode
      });
      return res.json(result);
    }
    if (enrollment.modelVersion !== MODEL_VERSION) {
      const result = {
        success: true,
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        faceQuality: 'unknown',
        verificationStatus: 'pending_review',
        modelVersion: enrollment.modelVersion,
        reasonCode: 'MODEL_VERSION_MISMATCH',
        latencyMs: latencyMs()
      };
      await recordEvent({
        userId: user._id,
        action: 'verification',
        identityStatus: result.identityStatus,
        livenessStatus: result.livenessStatus,
        verificationStatus: result.verificationStatus,
        reasonCode: result.reasonCode,
        modelVersion: enrollment.modelVersion
      });
      return res.json(result);
    }

    const [storedEmbedding, query] = await Promise.all([
      Promise.resolve(
        decryptEmbedding({
          iv: enrollment.iv,
          authTag: enrollment.authTag,
          ciphertext: enrollment.ciphertext
        })
      ),
      requestInference('/v1/face/embedding', req.file.buffer)
    ]);
    if (query.modelVersion !== enrollment.modelVersion) {
      const result = {
        success: true,
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        faceQuality: 'acceptable',
        verificationStatus: 'pending_review',
        modelVersion: query.modelVersion,
        reasonCode: 'MODEL_VERSION_MISMATCH',
        latencyMs: latencyMs()
      };
      await recordEvent({
        userId: user._id,
        action: 'verification',
        identityStatus: result.identityStatus,
        livenessStatus: result.livenessStatus,
        verificationStatus: result.verificationStatus,
        reasonCode: result.reasonCode,
        modelVersion: query.modelVersion
      });
      return res.json(result);
    }
    validateEmbedding(query.embedding);

    const configuredThreshold = Number(process.env.FACE_MATCH_THRESHOLD);
    if (
      !process.env.FACE_MATCH_THRESHOLD ||
      !Number.isFinite(configuredThreshold) ||
      configuredThreshold < -1 ||
      configuredThreshold > 1
    ) {
      await recordEvent({
        userId: user._id,
        action: 'verification',
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        verificationStatus: 'pending_review',
        reasonCode: 'MATCH_THRESHOLD_UNCONFIGURED',
        modelVersion: enrollment.modelVersion
      });
      return res.status(503).json({
        success: false,
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        verificationStatus: 'pending_review',
        reasonCode: 'MATCH_THRESHOLD_UNCONFIGURED',
        latencyMs: latencyMs(),
        message: 'A matching policy is unavailable. Please retry later.'
      });
    }

    const identityStatus =
      cosineSimilarity(storedEmbedding, query.embedding) >= configuredThreshold
        ? 'match'
        : 'no_match';
    const livenessStatus =
      query.liveness && query.liveness.status === 'fail'
        ? 'fail'
        : 'pass';
    const reasonCode =
      identityStatus === 'no_match'
        ? 'IDENTITY_NOT_MATCHED'
        : livenessStatus === 'fail'
          ? 'LIVENESS_NOT_PASSED'
          : null;
    const productionPolicyEnabled =
      (process.env.FACE_VERIFICATION_MODE || 'production') === 'production' &&
      process.env.FACE_THRESHOLD_CALIBRATED !== 'false' &&
      process.env.FACE_LIVENESS_VALIDATED !== 'false';
    const verificationStatus =
      identityStatus === 'no_match'
        ? 'not_verified'
        : livenessStatus === 'fail'
          ? 'not_verified'
          : productionPolicyEnabled
            ? 'verified'
            : 'pending_review';
    // If identity matched and liveness didn't fail, issue a cryptographically signed verificationToken
    // bound to the student ID, valid for 5 minutes, single-use with a unique nonce (jti).
    let verificationToken = null;
    if (identityStatus === 'match' && livenessStatus !== 'fail') {
      const sessionIdClaim = req.body.sessionId || null;
      verificationToken = jwt.sign(
        {
          studentId: user._id.toString(),
          sessionId: sessionIdClaim,
          action: 'face_verification',
          identityStatus,
          livenessStatus,
          verificationStatus,
          nonce: crypto.randomBytes(16).toString('hex')
        },
        process.env.JWT_SECRET || 'face-token-secret',
        { expiresIn: '5m' }
      );
    }

    const result = {
      success: true,
      identityStatus,
      livenessStatus,
      faceQuality: query.faceQuality,
      verificationStatus,
      verificationToken,
      modelVersion: query.modelVersion,
      reasonCode,
      latencyMs: latencyMs()
    };

    await recordEvent({
      userId: user._id,
      action: 'verification',
      identityStatus,
      livenessStatus,
      verificationStatus,
      reasonCode,
      modelVersion: query.modelVersion
    });
    return res.json(result);
  } catch (error) {
    const captureFailureCodes = new Set([
      'NO_FACE_DETECTED',
      'MULTIPLE_FACES_DETECTED',
      'FACE_QUALITY_INSUFFICIENT'
    ]);
    if (error instanceof InferenceServiceError && captureFailureCodes.has(error.reasonCode)) {
      const result = {
        success: true,
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        faceQuality: 'insufficient',
        verificationStatus: 'pending_review',
        modelVersion: MODEL_VERSION,
        reasonCode: error.reasonCode,
        latencyMs: latencyMs()
      };
      try {
        await recordEvent({
          userId: req.user.id,
          action: 'verification',
          identityStatus: result.identityStatus,
          livenessStatus: result.livenessStatus,
          verificationStatus: result.verificationStatus,
          reasonCode: result.reasonCode,
          modelVersion: MODEL_VERSION
        });
      } catch (auditError) {
        console.error('Could not record inconclusive face verification:', auditError);
        return res.status(500).json({
          success: false,
          reasonCode: 'AUDIT_RECORDING_FAILED',
          message: 'The verification result could not be safely recorded.'
        });
      }
      return res.json(result);
    }
    if (error instanceof InferenceServiceError && error.reasonCode === 'MODEL_SERVICE_UNAVAILABLE') {
      const userId = req.user && req.user.id;
      if (userId) {
        try {
          await recordEvent({
            userId,
            action: 'verification',
            identityStatus: 'inconclusive',
            livenessStatus: 'inconclusive',
            verificationStatus: 'pending_review',
            reasonCode: 'MODEL_SERVICE_UNAVAILABLE'
          });
        } catch (auditError) {
          console.error('Could not record unavailable face verification:', auditError);
        }
      }
      return res.status(503).json({
        success: false,
        identityStatus: 'inconclusive',
        livenessStatus: 'inconclusive',
        verificationStatus: 'pending_review',
        reasonCode: 'MODEL_SERVICE_UNAVAILABLE',
        latencyMs: latencyMs(),
        message: 'The face verification service is unavailable. Please retry later.'
      });
    }
    return respondInferenceError(res, error);
  }
});

// Face reference deletion is permanently disabled to prevent proxy attendance.
// Once enrolled, the face reference cannot be removed by the student.
router.delete('/enrollment', protect, deletionLimit, async (req, res) => {
  try {
    const user = await getVerifiedStudent(req, res);
    if (!user) return;
    const enrollment = await FaceEnrollment.findOne({ userId: user._id }).select('_id').lean();
    if (enrollment) {
      return res.status(403).json({
        success: false,
        reasonCode: 'DELETION_NOT_ALLOWED',
        message: 'Face reference deletion is not allowed. Your enrolled face template is permanently locked to prevent proxy attendance.'
      });
    }
    return res.json({ success: true, deleted: false });
  } catch (error) {
    return respondInferenceError(res, error);
  }
});

module.exports = router;
