const crypto = require('crypto');

const COOKIE_NAME = 'survey_session';
const SESSION_DURATION_MS = 24 * 60 * 60 * 1000; // 24시간

function sign(payload) {
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(payload).digest('hex');
}

function createSessionToken() {
  const issuedAt = String(Date.now());
  const signature = sign(issuedAt);
  return `${issuedAt}.${signature}`;
}

function isSessionTokenValid(token) {
  if (!token || typeof token !== 'string') return false;
  const [issuedAt, signature] = token.split('.');
  if (!issuedAt || !signature) return false;
  const expected = sign(issuedAt);
  const sigBuf = Buffer.from(signature, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }
  const age = Date.now() - Number(issuedAt);
  return age >= 0 && age <= SESSION_DURATION_MS;
}

function setSessionCookie(req, res) {
  res.cookie(COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_DURATION_MS,
    path: '/'
  });
}

function clearSessionCookie(req, res) {
  res.clearCookie(COOKIE_NAME, { path: '/' });
}

function isAuthenticated(req) {
  return isSessionTokenValid(req.cookies && req.cookies[COOKIE_NAME]);
}

function requireAuthMiddleware(req, res, next) {
  if (!isAuthenticated(req)) {
    return res.status(401).json({ error: '인증이 필요합니다.' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  requireAuthMiddleware
};
