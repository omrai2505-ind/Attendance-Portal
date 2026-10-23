/**
 * Optional Campus Network Verification Policy
 *
 * Requirements:
 * 1. Network checks must be disabled by default unless valid campus network ranges are explicitly configured.
 * 2. Must not block personal hotspots or mobile data under the default policy.
 * 3. Never trust arbitrary X-Forwarded-For headers without a trusted proxy configuration.
 * 4. Document limitations of VPNs, carrier NAT, and Wi-Fi networks.
 */

// Environment configuration:
// CAMPUS_NETWORK_CHECK_ENABLED=true/false (default false)
// CAMPUS_IP_RANGES="10.0.0.0/8,172.16.0.0/12,192.168.1.0/24" (example)

function isNetworkCheckEnabled() {
  return process.env.CAMPUS_NETWORK_CHECK_ENABLED === 'true';
}

/**
 * Parses configured campus IP CIDRs or prefix strings
 */
function getCampusIpRanges() {
  const raw = process.env.CAMPUS_IP_RANGES || '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Checks if an IP is within the configured campus ranges (simple prefix/exact match or CIDR check)
 */
function isCampusIp(ip) {
  if (!ip) return false;
  const ranges = getCampusIpRanges();
  if (!ranges.length) return false;

  for (const range of ranges) {
    if (range.includes('/')) {
      // CIDR range matching
      const [subnet, bits] = range.split('/');
      const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);
      const ipNum = ipToInt(ip);
      const subnetNum = ipToInt(subnet);
      if (ipNum !== null && subnetNum !== null && (ipNum & mask) === (subnetNum & mask)) {
        return true;
      }
    } else if (ip === range || ip.startsWith(range)) {
      return true;
    }
  }
  return false;
}

function ipToInt(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return null;
  }
  return (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
}

/**
 * Extracts client IP safely.
 * Only inspects req.ip (which Express populates based on trust proxy settings).
 */
function getClientIp(req) {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Evaluates network risk signal for audit and optional enforcement
 */
function evaluateNetworkRisk(req) {
  const ip = getClientIp(req);
  const enabled = isNetworkCheckEnabled();

  if (!enabled) {
    return {
      policyEnabled: false,
      clientIp: ip,
      isCampusNetwork: null,
      passed: true
    };
  }

  const campus = isCampusIp(ip);
  return {
    policyEnabled: true,
    clientIp: ip,
    isCampusNetwork: campus,
    passed: campus
  };
}

module.exports = {
  isNetworkCheckEnabled,
  getCampusIpRanges,
  isCampusIp,
  getClientIp,
  evaluateNetworkRisk
};
