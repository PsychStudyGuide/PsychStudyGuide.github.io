import test from "node:test";
import assert from "node:assert/strict";

import {
  decryptCourseBundle,
  encryptCoursePack,
  generateCourseCode,
  isStrongCourseCode,
  normalizeCourseCode,
  validateEncryptedBundle,
} from "../assets/course-crypto.js";

const pack = {
  app: { productName: "Study Companion" },
  course: { title: "General Psychology", instructor: "Professor Andrea", theme: {} },
  units: [{ id: "one", title: "Unit One" }],
  documents: [{ id: "lecture", unitId: "one", title: "Lecture", content: "Private course material" }],
};

test("generated course codes are strong and normalize consistently", () => {
  const code = generateCourseCode();
  assert.match(code, /^[A-Z2-9]{5}(?:-[A-Z2-9]{5}){3}$/);
  assert.equal(isStrongCourseCode(code), true);
  assert.equal(normalizeCourseCode(code.toLowerCase()), code.replaceAll("-", ""));
});

test("encrypted bundles round-trip without exposing readable course content", async () => {
  const code = generateCourseCode();
  const bundle = await encryptCoursePack(pack, code);
  validateEncryptedBundle(bundle);

  assert.equal(JSON.stringify(bundle).includes("Private course material"), false);
  assert.deepEqual(await decryptCourseBundle(bundle, code), pack);
  await assert.rejects(() => decryptCourseBundle(bundle, generateCourseCode()), /did not unlock/);
});
