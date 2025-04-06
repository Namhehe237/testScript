const crypto = require('crypto');

// Constants for AES encryption (you can replace with .env variables)
const algorithm = 'aes-256-cbc';
const secretKey = crypto.randomBytes(32); // Replace with your real key
const iv = crypto.randomBytes(16); // Initialization vector

/**
 * Encrypts a given text using AES-256-CBC
 */
function encrypt(text) {
  const cipher = crypto.createCipheriv(algorithm, secretKey, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return { encryptedData: encrypted, iv: iv.toString('hex') };
}

/**
 * Decrypts AES encrypted text
 */
function decrypt(encryptedData, ivHex) {
  const decipher = crypto.createDecipheriv(algorithm, secretKey, Buffer.from(ivHex, 'hex'));
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

describe('🔐 AES Encryption and Decryption for Sensitive Data', () => {
  const originalText = 'mySuperSecretPassword123!';

  test('Encrypt should return encrypted hex string and IV', () => {
    const { encryptedData, iv: usedIv } = encrypt(originalText);
    expect(typeof encryptedData).toBe('string');
    expect(typeof usedIv).toBe('string');
    expect(encryptedData).not.toEqual(originalText);
  });

  test('Decrypt should return the original text', () => {
    const { encryptedData, iv: usedIv } = encrypt(originalText);
    const decryptedText = decrypt(encryptedData, usedIv);
    expect(decryptedText).toBe(originalText);
  });

  test('Decrypting with wrong IV should fail or return incorrect value', () => {
    const { encryptedData } = encrypt(originalText);
    const fakeIv = crypto.randomBytes(16).toString('hex');

    expect(() => decrypt(encryptedData, fakeIv)).toThrow();
  });
});
