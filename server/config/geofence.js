/**
 * Geolocation & Geofencing Utilities
 *
 * Implements:
 * - Coordinate & accuracy input validation
 * - Haversine distance calculation (Earth radius: 6,371,000 meters)
 * - Conservative geofence evaluation: distanceMeters + accuracyMeters <= radiusMeters
 */

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_MAX_ACCURACY_METERS = 150; // Sensible default for mobile hotspots and campus Wi-Fi


/**
 * Validates coordinate pair and optional accuracy
 * Latitude must be in [-90, 90]
 * Longitude must be in [-180, 180]
 */
function isValidCoordinate(lat, lon) {
  if (lat === null || lat === undefined || lon === null || lon === undefined) {
    return false;
  }
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (!Number.isFinite(nLat) || !Number.isFinite(nLon)) {
    return false;
  }
  if (nLat < -90 || nLat > 90) {
    return false;
  }
  if (nLon < -180 || nLon > 180) {
    return false;
  }
  return true;
}

/**
 * Validates reported accuracy
 * Must be positive finite number <= maxAllowedAccuracy
 */
function isValidAccuracy(accuracy, maxAllowedAccuracy = DEFAULT_MAX_ACCURACY_METERS) {
  if (accuracy === null || accuracy === undefined) {
    return false;
  }
  const nAcc = Number(accuracy);
  if (!Number.isFinite(nAcc) || nAcc <= 0) {
    return false;
  }
  if (nAcc > maxAllowedAccuracy) {
    return false;
  }
  return true;
}

/**
 * Validates radius in meters
 * Must be finite, positive, <= maxRadius
 */
function isValidRadius(radius, maxRadius = 500) {
  if (radius === null || radius === undefined) {
    return false;
  }
  const nRad = Number(radius);
  if (!Number.isFinite(nRad) || nRad <= 0 || nRad > maxRadius) {
    return false;
  }
  return true;
}

/**
 * Calculates great-circle distance between two points on a sphere (Haversine formula)
 * @param {number} lat1 Latitude of point 1 in degrees
 * @param {number} lon1 Longitude of point 1 in degrees
 * @param {number} lat2 Latitude of point 2 in degrees
 * @param {number} lon2 Longitude of point 2 in degrees
 * @returns {number} Distance in meters
 */
function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  if (!isValidCoordinate(lat1, lon1) || !isValidCoordinate(lat2, lon2)) {
    throw new Error('INVALID_COORDINATES');
  }

  const toRad = (angle) => (angle * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const radLat1 = toRad(lat1);
  const radLat2 = toRad(lat2);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(radLat1) * Math.cos(radLat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return EARTH_RADIUS_METERS * c;
}

/**
 * Evaluates conservative geofencing:
 * distanceMeters + accuracyMeters <= radiusMeters
 *
 * @param {Object} classroomCoords { latitude, longitude, radiusMeters }
 * @param {Object} studentCoords { latitude, longitude, accuracy }
 * @param {Object} [options] { maxAccuracyMeters }
 * @returns {{ passed: boolean, distanceMeters: number, reasonCode: string|null }}
 */
function evaluateGeofence(classroomCoords, studentCoords, options = {}) {
  const maxAccuracy = options.maxAccuracyMeters || 
    (Number(process.env.GPS_MAX_ACCURACY_METERS) || DEFAULT_MAX_ACCURACY_METERS);

  if (
    !classroomCoords ||
    !isValidCoordinate(classroomCoords.latitude, classroomCoords.longitude) ||
    !isValidRadius(classroomCoords.radiusMeters)
  ) {
    return {
      passed: false,
      distanceMeters: null,
      reasonCode: 'SESSION_LOCATION_NOT_CONFIGURED'
    };
  }

  if (
    !studentCoords ||
    !isValidCoordinate(studentCoords.latitude, studentCoords.longitude)
  ) {
    return {
      passed: false,
      distanceMeters: null,
      reasonCode: 'INVALID_LOCATION_DATA'
    };
  }

  const accuracy = Number(studentCoords.accuracy);
  if (!Number.isFinite(accuracy) || accuracy <= 0) {
    return {
      passed: false,
      distanceMeters: null,
      reasonCode: 'LOCATION_UNRELIABLE'
    };
  }

  if (accuracy > maxAccuracy) {
    return {
      passed: false,
      distanceMeters: null,
      reasonCode: 'LOCATION_UNRELIABLE'
    };
  }

  const distanceMeters = calculateHaversineDistance(
    classroomCoords.latitude,
    classroomCoords.longitude,
    studentCoords.latitude,
    studentCoords.longitude
  );

  const bufferMeters = Number(options.bufferMeters) || 0;
  const totalEffectiveDistance = distanceMeters + accuracy;
  if (totalEffectiveDistance > classroomCoords.radiusMeters + bufferMeters) {
    return {
      passed: false,
      distanceMeters,
      reasonCode: 'LOCATION_OUT_OF_BOUNDS'
    };
  }

  return {
    passed: true,
    distanceMeters,
    reasonCode: null
  };
}

module.exports = {
  EARTH_RADIUS_METERS,
  DEFAULT_MAX_ACCURACY_METERS,
  isValidCoordinate,
  isValidAccuracy,
  isValidRadius,
  calculateHaversineDistance,
  evaluateGeofence
};
