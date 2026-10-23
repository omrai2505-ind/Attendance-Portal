const { ensureRunning, isServiceHealthy } = require('./inference-supervisor');

const DEFAULT_TIMEOUT_MS = 7000;
const MODEL_VERSION = 'yunet-2023mar+sface-2021dec-opencv-4.11';

class InferenceServiceError extends Error {
  constructor(reasonCode, statusCode = 503) {
    super(reasonCode);
    this.name = 'InferenceServiceError';
    this.reasonCode = reasonCode;
    this.statusCode = statusCode;
  }
}

/**
 * Perform an HTTP inference request to the Python FastAPI engine.
 * Automatically tries to start the engine if it is offline, and retries once upon connection failure.
 */
async function requestInference(endpoint, image, isRetry = false) {
  const serviceToken = process.env.FACE_SERVICE_TOKEN;
  if (!serviceToken) {
    throw new InferenceServiceError('MODEL_SERVICE_UNAVAILABLE');
  }

  const baseUrl = process.env.FACE_SERVICE_URL || 'http://127.0.0.1:8001';
  const timeout = Number(process.env.FACE_SERVICE_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 30000) {
    throw new InferenceServiceError('MODEL_SERVICE_UNAVAILABLE', 500);
  }

  let response;
  try {
    response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'image/jpeg',
        'X-Face-Service-Key': serviceToken
      },
      body: image,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    // If connection refused or network failure, attempt self-healing
    if (!isRetry) {
      console.warn(`[InferenceClient] Connection to face service at ${baseUrl} failed. Attempting auto-recovery...`);
      const recovered = await ensureRunning();
      if (recovered) {
        return requestInference(endpoint, image, true);
      }
    }

    // If mock or fallback allowed in development/demo mode
    if (process.env.ALLOW_FACE_FALLBACK === 'true' || process.env.FACE_VERIFICATION_MODE === 'mock') {
      console.warn(`[InferenceClient] Using mock fallback response for ${endpoint}`);
      return getMockInferenceResponse(endpoint);
    }

    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new InferenceServiceError('MODEL_SERVICE_UNAVAILABLE');
    }
    throw new InferenceServiceError('MODEL_SERVICE_UNAVAILABLE');
  }

  let result;
  try {
    result = await response.json();
  } catch (_error) {
    throw new InferenceServiceError('MODEL_SERVICE_UNAVAILABLE');
  }

  if (!response.ok) {
    const detail = result && result.detail;
    const reasonCode =
      detail && typeof detail.reasonCode === 'string'
        ? detail.reasonCode
        : 'MODEL_SERVICE_UNAVAILABLE';
    throw new InferenceServiceError(reasonCode, response.status);
  }
  return result;
}

/**
 * Deterministic fallback for offline demo or simulated environments
 */
function getMockInferenceResponse(endpoint) {
  if (endpoint.includes('inspect')) {
    return {
      state: 'ready',
      bounds: { x: 120, y: 100, width: 220, height: 220 },
      image: { width: 640, height: 480 },
      detectionLatencyMs: 18
    };
  }
  if (endpoint.includes('embedding')) {
    // Generate normalized 128-dimensional vector
    const val = 1 / Math.sqrt(128);
    const mockVector = new Array(128).fill(val);
    return {
      embedding: mockVector,
      modelVersion: MODEL_VERSION,
      faceQuality: 'acceptable',
      liveness: { status: 'pass' }
    };
  }
  return {};
}

module.exports = { InferenceServiceError, requestInference };

