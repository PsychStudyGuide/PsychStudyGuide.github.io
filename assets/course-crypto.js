const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export const COURSE_BUNDLE_FORMAT = "course-study-bundle";
export const COURSE_BUNDLE_VERSION = 1;
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

export function normalizeCourseCode(value) {
  return String(value || "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function generateCourseCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const characters = [...bytes].map((byte) => alphabet[byte & 31]);
  return Array.from({ length: 4 }, (_, index) => characters.slice(index * 5, index * 5 + 5).join("")).join("-");
}

export function isStrongCourseCode(value) {
  return normalizeCourseCode(value).length >= 16;
}

export async function encryptCoursePack(pack, courseCode) {
  requireWebCrypto();
  if (!isStrongCourseCode(courseCode)) {
    throw new Error("Use a generated course code or enter at least 16 letters and numbers.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveCourseKey(courseCode, salt, ["encrypt"]);
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(pack));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);

  return {
    format: COURSE_BUNDLE_FORMAT,
    version: COURSE_BUNDLE_VERSION,
    bundleId: crypto.randomUUID(),
    generatedAt: new Date().toISOString(),
    public: {
      productName: pack.app?.productName || "Course Study Companion",
      courseTitle: pack.course?.title || "Course Study Companion",
      instructor: pack.course?.instructor || "",
      theme: pack.course?.theme || {},
    },
    encryption: {
      cipher: "AES-GCM",
      keyDerivation: "PBKDF2",
      hash: "SHA-256",
      iterations: DEFAULT_PBKDF2_ITERATIONS,
      salt: bytesToBase64(salt),
      iv: bytesToBase64(iv),
    },
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptCourseBundle(bundle, courseCode) {
  requireWebCrypto();
  validateEncryptedBundle(bundle);
  const salt = base64ToBytes(bundle.encryption.salt);
  const iv = base64ToBytes(bundle.encryption.iv);
  const ciphertext = base64ToBytes(bundle.ciphertext);
  const key = await deriveCourseKey(courseCode, salt, ["decrypt"], bundle.encryption.iterations);

  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(TEXT_DECODER.decode(plaintext));
  } catch {
    throw new Error("That course code did not unlock this course.");
  }
}

export function validateEncryptedBundle(bundle) {
  if (
    bundle?.format !== COURSE_BUNDLE_FORMAT ||
    bundle?.version !== COURSE_BUNDLE_VERSION ||
    !bundle.bundleId ||
    !bundle.ciphertext ||
    bundle.encryption?.cipher !== "AES-GCM" ||
    bundle.encryption?.keyDerivation !== "PBKDF2" ||
    bundle.encryption?.hash !== "SHA-256" ||
    !Number.isInteger(bundle.encryption?.iterations) ||
    bundle.encryption.iterations < 100_000 ||
    !bundle.encryption.salt ||
    !bundle.encryption.iv
  ) {
    throw new Error("The published course bundle is missing required encryption information.");
  }
}

async function deriveCourseKey(courseCode, salt, usages, iterations = DEFAULT_PBKDF2_ITERATIONS) {
  const normalized = normalizeCourseCode(courseCode);
  if (!normalized) throw new Error("Enter the course access code.");
  const material = await crypto.subtle.importKey("raw", TEXT_ENCODER.encode(normalized), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function requireWebCrypto() {
  if (!globalThis.crypto?.subtle) {
    throw new Error("This browser does not support the secure course-unlock feature.");
  }
}
