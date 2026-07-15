import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

export function opaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaque(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${ciphertext.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptSecret(encoded: string, key: Buffer): string {
  if (key.length !== 32) throw new Error("AES-256-GCM requires a 32-byte key");
  const [version, ivRaw, ciphertextRaw, tagRaw] = encoded.split(".");
  if (version !== "v1" || !ivRaw || !ciphertextRaw || !tagRaw) {
    throw new Error("Unsupported encrypted value");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
