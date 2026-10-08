import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { encryptCoursePack, isStrongCourseCode } from "../assets/course-crypto.js";

const options = parseArguments(process.argv.slice(2));
if (!options.pack || !options.codeFile || !options.out) {
  fail("Usage: npm run build:course -- --pack <private.coursepack.json> --code-file <private-code.txt> --out <course.bundle.json>");
}

const packPath = resolve(options.pack);
const codePath = resolve(options.codeFile);
const outputPath = resolve(options.out);
const pack = JSON.parse(await readFile(packPath, "utf8"));
const codeFile = await readFile(codePath, "utf8");
const courseCode = codeFile.match(/\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}\b/i)?.[0] || codeFile.trim();

validatePack(pack);
if (!isStrongCourseCode(courseCode)) fail("The code file does not contain a strong course access code.");

pack.generatedAt = new Date().toISOString();
const bundle = await encryptCoursePack(pack, courseCode);
await writeFile(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
console.log(`Built encrypted bundle ${bundle.bundleId} for ${bundle.public.courseTitle}.`);

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (key) parsed[key] = values[index + 1];
  }
  return parsed;
}

function validatePack(value) {
  if (!value?.app?.productName || !value?.course?.title || !value?.companion?.name) {
    fail("The private course pack is missing app, course, or companion metadata.");
  }
  if (!Array.isArray(value.units) || !value.units.length || !Array.isArray(value.documents) || !value.documents.length) {
    fail("The private course pack needs at least one unit and one document.");
  }
  const unitIds = new Set(value.units.map((unit) => unit.id));
  const documentIds = new Set(value.documents.map((document) => document.id));
  if (unitIds.size !== value.units.length || documentIds.size !== value.documents.length) {
    fail("Unit and document IDs must be unique.");
  }
  if (value.documents.some((document) => !unitIds.has(document.unitId) || !String(document.content || "").trim())) {
    fail("Every document must contain text and belong to a known unit.");
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
