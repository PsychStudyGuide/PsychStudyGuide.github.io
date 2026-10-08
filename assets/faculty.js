import { encryptCoursePack, generateCourseCode, isStrongCourseCode } from "./course-crypto.js";

let pack;
const el = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  pack = blankCoursePack();
  hydrateForm();
  renderAll();
}

function cacheElements() {
  [
    "import-pack-input", "export-pack-button", "export-bundle-button", "export-bundle-button-bottom", "save-status",
    "builder-product-name", "builder-course-title", "builder-instructor", "builder-companion-name",
    "builder-welcome-heading", "builder-welcome-accent", "builder-welcome-text", "builder-primary-color",
    "builder-secondary-color", "builder-funding-notice", "builder-persona", "builder-guardrails",
    "unit-list", "add-unit-button", "unit-dialog", "new-unit-title", "new-unit-description", "save-unit-button",
    "document-unit-select", "add-documents-input", "document-list", "study-set-list", "add-study-set-button",
    "study-set-dialog", "new-set-title", "new-set-description", "new-set-unit-list", "save-study-set-button",
    "builder-course-code", "reveal-builder-code-button", "generate-course-code-button", "course-code-result",
    "generated-course-code", "copy-course-code-button",
    "faculty-toast",
  ].forEach((id) => (el[toCamel(id)] = document.getElementById(id)));
}

function bindEvents() {
  el.importPackInput.addEventListener("change", importPack);
  el.exportPackButton.addEventListener("click", exportPrivatePack);
  el.exportBundleButton.addEventListener("click", exportEncryptedBundle);
  el.exportBundleButtonBottom.addEventListener("click", exportEncryptedBundle);
  el.revealBuilderCodeButton.addEventListener("click", toggleCourseCodeVisibility);
  el.generateCourseCodeButton.addEventListener("click", createSecureCourseCode);
  el.copyCourseCodeButton.addEventListener("click", copyCourseCode);
  el.addUnitButton.addEventListener("click", () => el.unitDialog.showModal());
  el.saveUnitButton.addEventListener("click", addUnit);
  el.addDocumentsInput.addEventListener("change", addDocuments);
  el.addStudySetButton.addEventListener("click", openStudySetDialog);
  el.saveStudySetButton.addEventListener("click", addStudySet);
  document.querySelectorAll(".builder-field input, .builder-field textarea").forEach((input) => {
    input.addEventListener("input", markChanged);
  });
}

function blankCoursePack() {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    app: { productName: "Course Study Companion" },
    course: {
      id: "untitled-course",
      title: "Untitled Course",
      instructor: "",
      welcomeHeading: "Study what matters.",
      welcomeAccent: "Understand it deeply.",
      welcomeText: "Ask questions, practice for an exam, or teach a concept back. Every answer is checked against the course material you select.",
      onboardingText: "This optional companion uses your professor’s material to explain, quiz, and coach—without wandering away from what your course actually covers.",
      defaultScope: "all",
      theme: { primary: "#5d4be1", primaryStrong: "#4735ce", secondary: "#168f88" },
    },
    companion: { name: "Study Companion" },
    fundingNotice: {
      heading: "Important cost and funding notice",
      text: "This is an optional study aid. The study tool itself is free, but use of third-party AI services such as OpenRouter may involve personal charges. College educational resource funds may not be used to purchase OpenRouter credits or cover any related costs.",
    },
    modelPolicy: {
      maxPromptPerMillion: 0.15,
      maxCompletionPerMillion: 0.6,
      maxOutputTokens: 850,
      pricingSource: "OpenRouter live model catalog",
    },
    models: [
      { id: "google/gemini-2.5-flash-lite", label: "Fast and focused", displayName: "Gemini 2.5 Flash Lite", description: "A quick, low-cost choice for everyday studying." },
      { id: "openai/gpt-oss-20b", label: "Careful reasoning", displayName: "GPT OSS 20B", description: "A low-cost option for explanations and comparisons." },
      { id: "qwen/qwen3.5-flash-02-23", label: "Balanced", displayName: "Qwen 3.5 Flash", description: "A balanced option for quizzes and course review." },
    ],
    units: [],
    studySets: [],
    documents: [],
    persona: "You are a warm, direct, encouraging study companion. Explain clearly, ask useful follow-up questions, and help students retrieve and connect ideas rather than merely giving polished answers.",
    guardrails: "Use only the supplied course sources for factual course claims. Never browse the web or fill gaps from general knowledge. If the selected material does not support an answer, say so plainly. Do not complete graded assignments for the student; coach their learning instead. Cite only source IDs that appear in the supplied context.",
  };
}

function hydrateForm() {
  el.builderProductName.value = pack.app.productName || "";
  el.builderCourseTitle.value = pack.course.title || "";
  el.builderInstructor.value = pack.course.instructor || "";
  el.builderCompanionName.value = pack.companion.name || "";
  el.builderWelcomeHeading.value = pack.course.welcomeHeading || "";
  el.builderWelcomeAccent.value = pack.course.welcomeAccent || "";
  el.builderWelcomeText.value = pack.course.welcomeText || "";
  el.builderPrimaryColor.value = normalizeColor(pack.course.theme?.primary, "#5d4be1");
  el.builderSecondaryColor.value = normalizeColor(pack.course.theme?.secondary, "#168f88");
  el.builderFundingNotice.value = pack.fundingNotice.text || "";
  el.builderPersona.value = pack.persona || "";
  el.builderGuardrails.value = pack.guardrails || "";
}

function syncFormToPack() {
  pack.app.productName = el.builderProductName.value.trim();
  pack.course.title = el.builderCourseTitle.value.trim();
  pack.course.id = slugify(pack.course.title || "course");
  pack.course.instructor = el.builderInstructor.value.trim();
  pack.companion.name = el.builderCompanionName.value.trim();
  pack.course.welcomeHeading = el.builderWelcomeHeading.value.trim();
  pack.course.welcomeAccent = el.builderWelcomeAccent.value.trim();
  pack.course.welcomeText = el.builderWelcomeText.value.trim();
  pack.course.theme = pack.course.theme || {};
  pack.course.theme.primary = el.builderPrimaryColor.value;
  pack.course.theme.primaryStrong = shadeColor(el.builderPrimaryColor.value, -18);
  pack.course.theme.secondary = el.builderSecondaryColor.value;
  pack.fundingNotice.text = el.builderFundingNotice.value.trim();
  pack.persona = el.builderPersona.value.trim();
  pack.guardrails = el.builderGuardrails.value.trim();
}

function renderAll() {
  renderUnits();
  renderDocuments();
  renderStudySets();
  refreshUnitSelectors();
}

function renderUnits() {
  el.unitList.replaceChildren();
  pack.units.sort((a, b) => (a.order || 0) - (b.order || 0)).forEach((unit, index) => {
    const item = editableItem(index + 1, unit.title, unit.description || "No description");
    const actions = item.querySelector(".item-actions");
    const edit = tinyButton("Edit", () => {
      const title = prompt("Chapter title", unit.title);
      if (title === null) return;
      const description = prompt("Chapter description", unit.description || "");
      unit.title = title.trim() || unit.title;
      unit.description = description === null ? unit.description : description.trim();
      markChanged();
      renderAll();
    });
    const remove = tinyButton("Remove", () => removeUnit(unit.id), true);
    actions.append(edit, remove);
    el.unitList.append(item);
  });
}

function renderDocuments() {
  el.documentList.replaceChildren();
  pack.documents.forEach((document, index) => {
    const unit = pack.units.find((item) => item.id === document.unitId);
    const detail = `${unit?.title || "Unassigned"} · ${wordCount(document.content).toLocaleString()} words${document.needsReview ? " · Needs transcript review" : ""}`;
    const item = editableItem(index + 1, document.title, detail);
    const actions = item.querySelector(".item-actions");
    actions.append(
      tinyButton("Rename", () => {
        const title = prompt("Lecture title", document.title);
        if (title?.trim()) document.title = title.trim();
        markChanged();
        renderDocuments();
      }),
      tinyButton("Remove", () => {
        if (!confirm(`Remove “${document.title}” from this exported course pack?`)) return;
        pack.documents = pack.documents.filter((item) => item.id !== document.id);
        markChanged();
        renderDocuments();
      }, true),
    );
    el.documentList.append(item);
  });
}

function renderStudySets() {
  el.studySetList.replaceChildren();
  pack.studySets.forEach((set, index) => {
    const chapters = pack.units.filter((unit) => set.unitIds.includes(unit.id)).map((unit) => unit.title).join(" · ");
    const item = editableItem(index + 1, set.title, chapters || "No chapters selected");
    const actions = item.querySelector(".item-actions");
    actions.append(tinyButton("Remove", () => {
      if (!confirm(`Remove “${set.title}”? Course files will not be deleted.`)) return;
      pack.studySets = pack.studySets.filter((item) => item.id !== set.id);
      markChanged();
      renderStudySets();
    }, true));
    el.studySetList.append(item);
  });
}

function refreshUnitSelectors() {
  const current = el.documentUnitSelect.value;
  el.documentUnitSelect.replaceChildren();
  pack.units.forEach((unit) => {
    const option = document.createElement("option");
    option.value = unit.id;
    option.textContent = unit.title;
    el.documentUnitSelect.append(option);
  });
  if ([...el.documentUnitSelect.options].some((option) => option.value === current)) el.documentUnitSelect.value = current;
}

function editableItem(index, title, detail) {
  const item = document.createElement("article");
  item.className = "editable-item";
  const badge = document.createElement("span");
  badge.className = "editable-index";
  badge.textContent = index;
  const text = document.createElement("div");
  const strong = document.createElement("strong");
  const small = document.createElement("small");
  strong.textContent = title;
  small.textContent = detail;
  text.append(strong, small);
  const actions = document.createElement("div");
  actions.className = "item-actions";
  item.append(badge, text, actions);
  return item;
}

function tinyButton(label, action, remove = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `tiny-button${remove ? " remove" : ""}`;
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

function addUnit() {
  const title = el.newUnitTitle.value.trim();
  if (!title) return showToast("Give the chapter a title first.");
  const id = uniqueId(slugify(title), pack.units.map((unit) => unit.id));
  pack.units.push({ id, title, description: el.newUnitDescription.value.trim(), order: pack.units.length + 1 });
  el.newUnitTitle.value = "";
  el.newUnitDescription.value = "";
  el.unitDialog.close();
  markChanged();
  renderAll();
}

function removeUnit(id) {
  if (pack.documents.some((document) => document.unitId === id)) {
    showToast("Move or remove that chapter’s transcripts before removing the chapter.");
    return;
  }
  if (!confirm("Remove this empty chapter from the course pack?")) return;
  pack.units = pack.units.filter((unit) => unit.id !== id);
  pack.studySets.forEach((set) => (set.unitIds = set.unitIds.filter((unitId) => unitId !== id)));
  markChanged();
  renderAll();
}

async function addDocuments(event) {
  const files = [...event.target.files];
  const unitId = el.documentUnitSelect.value;
  if (!unitId || !files.length) return;
  for (const file of files) {
    const content = await file.text();
    const title = file.name.replace(/\.(txt|md)$/i, "").replace(/[-_]+/g, " ");
    const id = uniqueId(slugify(title), pack.documents.map((document) => document.id));
    pack.documents.push({
      id,
      unitId,
      title,
      description: "Instructor-provided course source.",
      file: file.name,
      needsReview: true,
      content,
    });
  }
  event.target.value = "";
  markChanged();
  renderDocuments();
  showToast(`${files.length} transcript${files.length === 1 ? "" : "s"} added to the course pack.`);
}

function openStudySetDialog() {
  el.newSetUnitList.replaceChildren();
  pack.units.forEach((unit) => {
    const label = document.createElement("label");
    label.className = "check-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = unit.id;
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = unit.title;
    text.append(title);
    label.append(input, text);
    el.newSetUnitList.append(label);
  });
  el.studySetDialog.showModal();
}

function addStudySet() {
  const title = el.newSetTitle.value.trim();
  const unitIds = [...el.newSetUnitList.querySelectorAll("input:checked")].map((input) => input.value);
  if (!title || !unitIds.length) return showToast("Give the study set a name and choose at least one chapter.");
  pack.studySets.push({
    id: uniqueId(slugify(title), pack.studySets.map((set) => set.id)),
    title,
    description: el.newSetDescription.value.trim(),
    unitIds,
  });
  el.newSetTitle.value = "";
  el.newSetDescription.value = "";
  el.studySetDialog.close();
  markChanged();
  renderStudySets();
}

async function importPack(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const imported = JSON.parse(await file.text());
    if (!imported?.app || !imported?.course?.title || !imported?.companion || !imported?.fundingNotice || !Array.isArray(imported.units) || !Array.isArray(imported.documents)) throw new Error();
    pack = imported;
    hydrateForm();
    renderAll();
    markChanged("Private course loaded locally");
  } catch {
    showToast("That file is not a valid course pack.");
  }
  event.target.value = "";
}

function exportPrivatePack() {
  syncFormToPack();
  pack.generatedAt = new Date().toISOString();
  downloadJson(pack, `${slugify(pack.course.title)}.coursepack.json`);
  el.saveStatus.textContent = "Private editing backup downloaded";
  showToast("Private backup downloaded. Do not upload that file to GitHub.");
}

async function exportEncryptedBundle() {
  syncFormToPack();
  if (!pack.course.title || !pack.units.length || !pack.documents.length) {
    showToast("Add a course title, at least one chapter, and at least one course source first.");
    return;
  }
  const code = el.builderCourseCode.value;
  if (!isStrongCourseCode(code)) {
    showToast("Generate a secure course code before downloading the website bundle.");
    el.builderCourseCode.focus();
    return;
  }

  el.exportBundleButton.disabled = true;
  el.exportBundleButtonBottom.disabled = true;
  el.saveStatus.textContent = "Encrypting locally…";
  try {
    pack.generatedAt = new Date().toISOString();
    const bundle = await encryptCoursePack(pack, code);
    downloadJson(bundle, "course.bundle.json");
    revealGeneratedCode(code);
    el.saveStatus.textContent = "Encrypted website bundle downloaded";
    showToast("Encrypted bundle downloaded. This is the file that may be uploaded to GitHub.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "The encrypted bundle could not be created.");
    el.saveStatus.textContent = "Encryption needs attention";
  } finally {
    el.exportBundleButton.disabled = false;
    el.exportBundleButtonBottom.disabled = false;
  }
}

function toggleCourseCodeVisibility() {
  const reveal = el.builderCourseCode.type === "password";
  el.builderCourseCode.type = reveal ? "text" : "password";
  el.revealBuilderCodeButton.textContent = reveal ? "Hide" : "Show";
}

function createSecureCourseCode() {
  const code = generateCourseCode();
  el.builderCourseCode.value = code;
  revealGeneratedCode(code);
  markChanged("Secure code generated — download a new encrypted bundle");
}

function revealGeneratedCode(code) {
  el.generatedCourseCode.textContent = code;
  el.courseCodeResult.hidden = false;
}

async function copyCourseCode() {
  const code = el.generatedCourseCode.textContent;
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast("Course code copied.");
  } catch {
    el.builderCourseCode.type = "text";
    el.builderCourseCode.select();
    showToast("The code is selected. Press Ctrl+C to copy it.");
  }
}

function downloadJson(value, filename) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function markChanged(message = "Unsaved changes in this browser") {
  el.saveStatus.textContent = message;
}

function showToast(message) {
  el.facultyToast.textContent = message;
  el.facultyToast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.facultyToast.classList.remove("show"), 3500);
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function slugify(text) {
  return String(text).toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}

function uniqueId(base, existing) {
  let id = base;
  let index = 2;
  while (existing.includes(id)) id = `${base}-${index++}`;
  return id;
}

function normalizeColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
}

function shadeColor(hex, percent) {
  const number = parseInt(hex.slice(1), 16);
  const amount = Math.round(2.55 * percent);
  const r = Math.max(0, Math.min(255, (number >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((number >> 8) & 0xff) + amount));
  const b = Math.max(0, Math.min(255, (number & 0xff) + amount));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}
