import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type SecretCipher = {
  encrypt: (plaintext: string) => string;
  decrypt: (ciphertext: string) => string;
};

export function createSecretCipher(key: Buffer): SecretCipher {
  if (key.length !== 32) {
    throw new Error("Invalid encryption key");
  }

  return {
    encrypt(plaintext) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString(
        "base64url",
      );
    },
    decrypt(ciphertext) {
      const encrypted = Buffer.from(ciphertext, "base64url");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        encrypted.subarray(0, 12),
      );
      decipher.setAuthTag(encrypted.subarray(12, 28));
      return Buffer.concat([
        decipher.update(encrypted.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
