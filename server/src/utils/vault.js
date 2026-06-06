/**
 * Vault: secure credential storage
 * Uses AES-256-GCM with a master key from env.
 * In production, replace with HashiCorp Vault / AWS Secrets Manager / etc.
 */
const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const MASTER_KEY = (() => {
  const key = process.env.VAULT_MASTER_KEY || process.env.JWT_SECRET || 'dev-fallback-key-32-chars-min!!';
  if (key.length < 32) {
    return crypto.createHash('sha256').update(key).digest();
  }
  return Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8');
})();

function encrypt(plaintext) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, MASTER_KEY, iv);
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : Buffer.from(plaintext);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  try {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.slice(0, IV_LENGTH);
    const tag = buf.slice(IV_LENGTH, IV_LENGTH + 16);
    const data = buf.slice(IV_LENGTH + 16);
    const decipher = crypto.createDecipheriv(ALGO, MASTER_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    return null;
  }
}

function mask(value) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '*'.repeat(Math.min(s.length - 4, 8)) + s.slice(-2);
}

function encryptCredentials(creds) {
  const out = {};
  for (const [k, v] of Object.entries(creds || {})) {
    if (v == null || v === '') {
      out[k] = null;
    } else if (['password', 'apiKey', 'clientSecret', 'token', 'secret', 'fingerprint'].includes(k)) {
      out[k] = encrypt(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function decryptCredentials(creds) {
  const out = {};
  for (const [k, v] of Object.entries(creds || {})) {
    if (['password', 'apiKey', 'clientSecret', 'token', 'secret', 'fingerprint'].includes(k)) {
      out[k] = decrypt(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeForClient(camera) {
  if (!camera) return camera;
  const conn = camera.connection || {};
  const sanitized = { ...camera };
  sanitized.connection = {
    host: conn.host,
    port: conn.port,
    path: conn.path,
    username: conn.username,
    authType: conn.authType,
    useTLS: conn.useTLS,
    vendor: conn.vendor,
    model: conn.model,
    protocol: conn.protocol
  };
  sanitized.credentialsMasked = {
    password: mask(decrypt(conn.password)),
    apiKey: mask(decrypt(conn.apiKey)),
    clientSecret: mask(decrypt(conn.clientSecret)),
    token: mask(decrypt(conn.token))
  };
  return sanitized;
}

module.exports = {
  encrypt,
  decrypt,
  mask,
  encryptCredentials,
  decryptCredentials,
  sanitizeForClient
};
