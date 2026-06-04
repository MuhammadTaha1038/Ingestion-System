import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;

const getKey = (): Buffer => {
  const key = process.env.ENCRYPTION_KEY ?? "";
  if (!key || key.length < 32) {
    throw new Error("ENCRYPTION_KEY must be set to 32+ chars");
  }

  return Buffer.from(key.slice(0,32));
};

export const encrypt = (plaintext: string): string => {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
};

export const decrypt = (payload: string): string => {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.slice(0, IV_LEN);
  const tag = buf.slice(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.slice(IV_LEN + TAG_LEN);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const out = Buffer.concat([decipher.update(enc), decipher.final()]);
  return out.toString("utf8");
};
