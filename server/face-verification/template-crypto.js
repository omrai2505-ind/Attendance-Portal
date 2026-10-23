const crypto = require('crypto');
const { validateEmbedding } = require('./embeddings');

class TemplateEncryptionConfigError extends Error {}
class TemplateIntegrityError extends Error {}

function encryptionKey() {
  const key = process.env.FACE_TEMPLATE_ENCRYPTION_KEY;
  if (!key || !/^[a-fA-F0-9]{64}$/.test(key)) {
    throw new TemplateEncryptionConfigError(
      'FACE_TEMPLATE_ENCRYPTION_KEY must be configured as 64 hexadecimal characters'
    );
  }
  return Buffer.from(key, 'hex');
}

function encryptEmbedding(embedding) {
  validateEmbedding(embedding);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(embedding), 'utf8'),
    cipher.final()
  ]);
  return {
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64')
  };
}

function decryptEmbedding(encrypted) {
  try {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(encrypted.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8');
    return validateEmbedding(JSON.parse(plaintext));
  } catch (error) {
    if (error instanceof TemplateEncryptionConfigError) {
      throw error;
    }
    throw new TemplateIntegrityError('The stored face reference failed integrity validation');
  }
}

module.exports = {
  TemplateEncryptionConfigError,
  TemplateIntegrityError,
  encryptEmbedding,
  decryptEmbedding
};
