function createUserRateLimiter({ limit, windowMs }) {
  const requests = new Map();

  return (req, res, next) => {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Authentication is required'
      });
    }

    const now = Date.now();
    if (requests.size > 5000) {
      for (const [key, record] of requests) {
        if (now - record.startedAt >= windowMs) requests.delete(key);
      }
    }
    const current = requests.get(String(userId));
    if (!current || now - current.startedAt >= windowMs) {
      requests.set(String(userId), { startedAt: now, count: 1 });
      return next();
    }

    if (current.count >= limit) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        reasonCode: 'RATE_LIMITED',
        message: 'Too many face verification requests. Please wait and retry.'
      });
    }

    current.count += 1;
    return next();
  };
}

module.exports = { createUserRateLimiter };
