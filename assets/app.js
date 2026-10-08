import { decryptCourseBundle, validateEncryptedBundle } from "./course-crypto.js";
import {
  buildChunks,
  buildRetrievalQuery,
  inferSupportingSourceIds,
  retrieveEvidence,
} from "./grounding.js";

const COURSE_BUNDLE_URL = "course/course.bundle.json";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const SHARED_IDLE_MS = 20 * 60 * 1000;
const MAX_HISTORY_TURNS = 8;
const LOW_REASONING_MODELS = new Set(["openai/gpt-oss-20b"]);
const COURSE_DB_NAME = "course-study-companion";
const COURSE_DB_STORE = "course-cache";
const COURSE_DB_KEY = "active-course";

const state = {
  bundle: null,
  pack: null,
  chunks: [],
  selectedScope: "",
  customUnitIds: [],
  mode: "ask",
  history: [],
  activeRequest: false,
  latestAnswer: "",
  modelCatalog: new Map(),
  unavailableModelIds: new Set(),
  idleTimer: null,
};

const el = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  restoreAccessibilityPreferences();
  await loadCourseBundle();
  registerServiceWorker();
}

function cacheElements() {
  [
    "product-name",
    "course-name-top",
    "course-access-modal",
    "access-course-title",
    "course-code-input",
    "reveal-course-code-button",
    "unlock-course-button",
    "course-unlock-status",
    "scope-select",
    "scope-summary",
    "mobile-scope-label",
    "custom-scope-button",
    "custom-scope-list",
    "apply-custom-scope-button",
    "conversation",
    "welcome-panel",
    "welcome-heading",
    "welcome-copy",
    "message-input",
    "send-button",
    "read-selection-button",
    "new-topic-button",
    "notes-button",
    "theme-button",
    "settings-button",
    "settings-modal",
    "onboarding-modal",
    "onboarding-title",
    "onboarding-description",
    "funding-notice-text",
    "funding-acknowledgement",
    "begin-setup-button",
    "setup-modal",
    "api-key-input",
    "reveal-key-button",
    "model-select",
    "model-description",
    "save-setup-button",
    "scope-modal",
    "text-size-select",
    "font-select",
    "contrast-toggle",
    "reopen-setup-button",
    "forget-course-button",
    "clear-data-button",
    "sidebar",
    "sidebar-close",
    "mobile-scope-button",
    "toast",
  ].forEach((id) => {
    el[toCamel(id)] = document.getElementById(id);
  });
  el.modeTabs = [...document.querySelectorAll(".mode-tab")];
  el.starterCards = [...document.querySelectorAll(".starter-card")];
}

function bindEvents() {
  el.revealCourseCodeButton.addEventListener("click", () => {
    const reveal = el.courseCodeInput.type === "password";
    el.courseCodeInput.type = reveal ? "text" : "password";
    el.revealCourseCodeButton.textContent = reveal ? "Hide" : "Show";
  });
  el.unlockCourseButton.addEventListener("click", unlockCourse);
  el.courseCodeInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      unlockCourse();
    }
  });

  el.fundingAcknowledgement.addEventListener("change", () => {
    el.beginSetupButton.disabled = !el.fundingAcknowledgement.checked;
  });

  el.beginSetupButton.addEventListener("click", () => {
    el.onboardingModal.close();
    el.setupModal.showModal();
  });

  el.revealKeyButton.addEventListener("click", () => {
    const reveal = el.apiKeyInput.type === "password";
    el.apiKeyInput.type = reveal ? "text" : "password";
    el.revealKeyButton.textContent = reveal ? "Hide" : "Show";
  });

  el.saveSetupButton.addEventListener("click", saveSetup);
  el.modelSelect.addEventListener("change", updateModelDescription);
  el.settingsButton.addEventListener("click", () => el.settingsModal.showModal());
  el.reopenSetupButton.addEventListener("click", () => {
    el.settingsModal.close();
    hydrateSetupForm();
    el.setupModal.showModal();
  });
  el.forgetCourseButton.addEventListener("click", forgetCourseAccess);
  el.clearDataButton.addEventListener("click", clearAllData);

  el.themeButton.addEventListener("click", toggleTheme);
  el.textSizeSelect.addEventListener("change", applyAccessibilityPreferences);
  el.fontSelect.addEventListener("change", applyAccessibilityPreferences);
  el.contrastToggle.addEventListener("change", applyAccessibilityPreferences);

  el.scopeSelect.addEventListener("change", () => setScope(el.scopeSelect.value));
  el.customScopeButton.addEventListener("click", openCustomScope);
  el.applyCustomScopeButton.addEventListener("click", applyCustomScope);

  el.mobileScopeButton.addEventListener("click", openSidebar);
  el.sidebarClose.addEventListener("click", () => closeSidebar(true));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && el.sidebar.classList.contains("open")) closeSidebar(true);
  });

  el.modeTabs.forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });

  el.starterCards.forEach((card) => {
    card.addEventListener("click", () => {
      if (card.dataset.switchMode) {
        setMode(card.dataset.switchMode);
        return;
      }
      el.messageInput.value = card.dataset.prompt || "";
      autoSizeInput();
      sendCurrentMessage();
    });
  });

  el.messageInput.addEventListener("input", autoSizeInput);
  el.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });
  el.sendButton.addEventListener("click", sendCurrentMessage);
  el.newTopicButton.addEventListener("click", resetConversation);
  el.notesButton.addEventListener("click", makeStudyNotes);
  el.readSelectionButton.addEventListener("click", readLatestAnswer);

  ["pointerdown", "keydown", "scroll"].forEach((eventName) => {
    window.addEventListener(eventName, resetSharedIdleTimer, { passive: true });
  });
}

async function loadCourseBundle() {
  try {
    const response = await fetch(COURSE_BUNDLE_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Encrypted course bundle returned ${response.status}`);
    state.bundle = await response.json();
    validateEncryptedBundle(state.bundle);
    applyPublicBundleMetadata();

    const mode = localStorage.getItem("study-device-mode") || "";
    const cached = mode === "personal" ? await readCachedCourse() : null;
    if (cached?.bundleId === state.bundle.bundleId && cached.pack) {
      await activateCoursePack(cached.pack);
      continueAfterCourseUnlock();
      return;
    }

    await deleteCachedCourse();
    el.courseAccessModal.showModal();
    queueMicrotask(() => el.courseCodeInput.focus());
  } catch (error) {
    console.error(error);
    showFatalCourseError();
  }
}

function applyPublicBundleMetadata() {
  const metadata = state.bundle.public || {};
  const productName = metadata.productName || "Course Study Companion";
  const courseTitle = metadata.courseTitle || "Course Study Companion";
  document.title = `${courseTitle} · ${productName}`;
  el.productName.textContent = productName;
  el.courseNameTop.textContent = courseTitle;
  el.accessCourseTitle.textContent = `Unlock ${courseTitle}`;
  if (metadata.theme) {
    document.documentElement.style.setProperty("--primary", metadata.theme.primary || "#5d4be1");
    document.documentElement.style.setProperty("--primary-strong", metadata.theme.primaryStrong || "#4735ce");
    document.documentElement.style.setProperty("--teal", metadata.theme.secondary || "#168f88");
  }
}

async function unlockCourse() {
  if (!state.bundle) return;
  const code = el.courseCodeInput.value;
  if (!code.trim()) {
    el.courseUnlockStatus.textContent = "Enter the course code provided by your professor.";
    el.courseCodeInput.focus();
    return;
  }

  el.unlockCourseButton.disabled = true;
  el.courseCodeInput.disabled = true;
  el.courseUnlockStatus.textContent = "Unlocking the encrypted course…";
  try {
    const pack = await decryptCourseBundle(state.bundle, code);
    await activateCoursePack(pack);
    el.courseCodeInput.value = "";
    el.courseCodeInput.type = "password";
    el.revealCourseCodeButton.textContent = "Show";
    el.courseAccessModal.close();
    el.courseUnlockStatus.textContent = "Hyphens and capitalization do not matter.";

    const mode = localStorage.getItem("study-device-mode") || "";
    if (mode === "personal") await cacheCoursePack();
    if (mode === "shared") await deleteCachedCourse();
    continueAfterCourseUnlock();
  } catch (error) {
    console.error(error);
    el.courseUnlockStatus.textContent = error.message || "That code did not unlock this course.";
    el.courseCodeInput.select();
  } finally {
    el.unlockCourseButton.disabled = false;
    el.courseCodeInput.disabled = false;
  }
}

async function activateCoursePack(pack) {
  validateCoursePack(pack);
  state.pack = pack;
  applyCoursePack();
  state.chunks = buildChunks(pack.documents, pack.units);
  await populateApprovedModels();
}

function continueAfterCourseUnlock() {
  const completed = localStorage.getItem("study-onboarding-complete") === "true";
  if (!completed) {
    el.fundingAcknowledgement.checked = false;
    el.beginSetupButton.disabled = true;
    el.onboardingModal.showModal();
    return;
  }
  restoreSetup();
}

function validateCoursePack(pack) {
  if (!pack?.course?.title || !Array.isArray(pack.units) || !Array.isArray(pack.documents)) {
    throw new Error("The course pack is missing required course, unit, or document data.");
  }
}

function applyCoursePack() {
  const { app, course, companion, fundingNotice } = state.pack;
  document.title = `${course.title} · ${app.productName}`;
  el.productName.textContent = app.productName;
  el.courseNameTop.textContent = course.title;
  el.welcomeHeading.innerHTML = `${escapeHtml(course.welcomeHeading || "Study what matters.")}<br><span>${escapeHtml(
    course.welcomeAccent || "Understand it deeply.",
  )}</span>`;
  el.welcomeCopy.textContent =
    course.welcomeText ||
    `Ask questions, practice for an exam, or teach a concept back to ${companion.name}. Every answer is checked against the course material you select.`;
  el.onboardingTitle.textContent = `A smarter way to study ${course.title}`;
  el.onboardingDescription.textContent =
    course.onboardingText ||
    "This optional companion uses your professor’s material to explain, quiz, and coach—without wandering away from what your course actually covers.";
  el.fundingNoticeText.textContent = fundingNotice.text;

  if (course.theme) {
    document.documentElement.style.setProperty("--primary", course.theme.primary || "#5d4be1");
    document.documentElement.style.setProperty("--primary-strong", course.theme.primaryStrong || "#4735ce");
    document.documentElement.style.setProperty("--teal", course.theme.secondary || "#168f88");
  }

  buildScopeOptions();
  buildCustomScopeList();
}

function buildScopeOptions() {
  const options = [];
  const add = (value, label) => options.push(`<option value="${escapeAttribute(value)}">${escapeHtml(label)}</option>`);

  add("all", "Whole course");
  state.pack.studySets.forEach((set) => add(`set:${set.id}`, set.title));
  state.pack.units.forEach((unit) => add(`unit:${unit.id}`, unit.title));
  state.pack.documents.forEach((document) => add(`doc:${document.id}`, `↳ ${document.title}`));
  add("custom", "Custom chapter selection…");

  el.scopeSelect.innerHTML = options.join("");
  const defaultScope = state.pack.course.defaultScope || (state.pack.units[0] ? `unit:${state.pack.units[0].id}` : "all");
  setScope(defaultScope);
}

function buildCustomScopeList() {
  el.customScopeList.replaceChildren();
  state.pack.units.forEach((unit) => {
    const label = document.createElement("label");
    label.className = "check-item";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = unit.id;
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const detail = document.createElement("small");
    title.textContent = unit.title;
    detail.textContent = unit.description || `${documentsForUnits([unit.id]).length} course source(s)`;
    text.append(title, detail);
    label.append(input, text);
    el.customScopeList.append(label);
  });
}

function setScope(value) {
  if (value === "custom") {
    openCustomScope();
    el.scopeSelect.value = state.selectedScope || "all";
    return;
  }
  state.selectedScope = value;
  el.scopeSelect.value = value;
  const scope = resolveScope();
  el.mobileScopeLabel.textContent = scope.title;
  el.scopeSummary.innerHTML = `<strong>${escapeHtml(scope.title)}</strong><small>${escapeHtml(scope.description)}</small>`;
  closeSidebar();
}

function resolveScope() {
  const value = state.selectedScope;
  if (value === "all") {
    return {
      title: "Whole course",
      description: `${state.pack.units.length} chapters · ${state.pack.documents.length} course sources`,
      documentIds: state.pack.documents.map((doc) => doc.id),
    };
  }
  if (value === "custom") {
    const units = state.pack.units.filter((unit) => state.customUnitIds.includes(unit.id));
    return {
      title: units.length ? `${units.length} selected chapters` : "Custom scope",
      description: units.map((unit) => unit.title).join(" · ") || "No chapters selected",
      documentIds: documentsForUnits(state.customUnitIds).map((doc) => doc.id),
    };
  }
  const [type, id] = value.split(":");
  if (type === "set") {
    const set = state.pack.studySets.find((item) => item.id === id);
    const documents = documentsForUnits(set?.unitIds || []);
    return {
      title: set?.title || "Study set",
      description: set?.description || `${documents.length} course sources`,
      documentIds: documents.map((doc) => doc.id),
    };
  }
  if (type === "unit") {
    const unit = state.pack.units.find((item) => item.id === id);
    const documents = documentsForUnits([id]);
    return {
      title: unit?.title || "Chapter",
      description: unit?.description || `${documents.length} course sources`,
      documentIds: documents.map((doc) => doc.id),
    };
  }
  const document = state.pack.documents.find((item) => item.id === id);
  return {
    title: document?.title || "Course source",
    description: document?.description || "One selected course source",
    documentIds: document ? [document.id] : [],
  };
}

function documentsForUnits(unitIds) {
  return state.pack.documents.filter((document) => unitIds.includes(document.unitId));
}

function openCustomScope() {
  const selected = new Set(state.customUnitIds);
  el.customScopeList.querySelectorAll("input").forEach((input) => {
    input.checked = selected.has(input.value);
  });
  el.scopeModal.showModal();
}

function applyCustomScope() {
  state.customUnitIds = [...el.customScopeList.querySelectorAll("input:checked")].map((input) => input.value);
  if (!state.customUnitIds.length) {
    showToast("Choose at least one chapter.");
    return;
  }
  el.scopeModal.close();
  state.selectedScope = "custom";
  el.scopeSelect.value = "custom";
  const scope = resolveScope();
  el.mobileScopeLabel.textContent = scope.title;
  el.scopeSummary.innerHTML = `<strong>${escapeHtml(scope.title)}</strong><small>${escapeHtml(scope.description)}</small>`;
  closeSidebar();
}

async function populateApprovedModels() {
  if (!state.pack) return;
  el.modelSelect.innerHTML = '<option value="">Checking approved models…</option>';
  el.modelSelect.disabled = true;

  try {
    const response = await fetch(OPENROUTER_MODELS_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Model catalog returned ${response.status}`);
    const payload = await response.json();
    state.modelCatalog = new Map((payload.data || []).map((model) => [model.id, model]));
  } catch (error) {
    console.warn("Could not verify current model prices", error);
    state.modelCatalog = new Map();
  }

  const approved = state.pack.models.filter((model) => isModelWithinCeiling(model));
  el.modelSelect.replaceChildren();
  approved.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.costLabel
      ? `${model.label} — ${model.displayName} — ${model.costLabel}`
      : `${model.label} — ${model.displayName}`;
    option.dataset.description = model.description;
    el.modelSelect.append(option);
  });

  if (!approved.length) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No approved models currently available";
    el.modelSelect.append(option);
    el.modelDescription.textContent = "The approved lineup is unavailable or exceeds the instructor’s price ceiling.";
    return;
  }

  el.modelSelect.disabled = false;
  updateModelDescription();
}

function isModelWithinCeiling(configuredModel) {
  if (state.unavailableModelIds.has(configuredModel.id)) return false;
  const catalogModel = state.modelCatalog.get(configuredModel.id);
  if (!catalogModel) return configuredModel.allowWhenCatalogUnavailable === true && state.modelCatalog.size === 0;
  const promptPerMillion = Number(catalogModel.pricing?.prompt) * 1_000_000;
  const completionPerMillion = Number(catalogModel.pricing?.completion) * 1_000_000;
  const ceiling = state.pack.modelPolicy;
  return (
    Number.isFinite(promptPerMillion) &&
    Number.isFinite(completionPerMillion) &&
    promptPerMillion <= ceiling.maxPromptPerMillion &&
    completionPerMillion <= ceiling.maxCompletionPerMillion
  );
}

function updateModelDescription() {
  const model = state.pack.models.find((item) => item.id === el.modelSelect.value);
  el.modelDescription.textContent = model?.description || "Only instructor-approved, low-cost models appear here.";
}

function restoreSetup() {
  const mode = localStorage.getItem("study-device-mode") || "";
  const key = getStoredApiKey(mode);
  const completed = localStorage.getItem("study-onboarding-complete") === "true";
  if (!completed) {
    el.onboardingModal.showModal();
    return;
  }
  if (!key) {
    hydrateSetupForm();
    el.setupModal.showModal();
  }
  if (mode === "shared") resetSharedIdleTimer();
}

function hydrateSetupForm() {
  const mode = localStorage.getItem("study-device-mode") || "personal";
  const radio = document.querySelector(`input[name="device-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  el.apiKeyInput.value = getStoredApiKey(mode);
  const storedModel = localStorage.getItem("study-model-id");
  if (storedModel && [...el.modelSelect.options].some((option) => option.value === storedModel)) {
    el.modelSelect.value = storedModel;
  }
  updateModelDescription();
}

async function saveSetup() {
  const mode = document.querySelector('input[name="device-mode"]:checked')?.value || "personal";
  const key = el.apiKeyInput.value.trim();
  const model = el.modelSelect.value;

  if (!key.startsWith("sk-or-")) {
    showToast("That does not look like an OpenRouter API key.");
    el.apiKeyInput.focus();
    return;
  }
  if (!model) {
    showToast("Choose an approved model before continuing.");
    return;
  }

  localStorage.setItem("study-device-mode", mode);
  localStorage.setItem("study-model-id", model);
  localStorage.setItem("study-onboarding-complete", "true");
  if (mode === "shared") {
    localStorage.removeItem("study-api-key");
    sessionStorage.setItem("study-api-key", key);
    await deleteCachedCourse();
    resetSharedIdleTimer();
  } else {
    sessionStorage.removeItem("study-api-key");
    localStorage.setItem("study-api-key", key);
    await cacheCoursePack();
    clearTimeout(state.idleTimer);
  }
  el.apiKeyInput.value = "";
  el.setupModal.close();
  showToast("Setup saved. Your key remains in this browser.");
}

function getStoredApiKey(mode = localStorage.getItem("study-device-mode")) {
  return mode === "shared" ? sessionStorage.getItem("study-api-key") || "" : localStorage.getItem("study-api-key") || "";
}

function resetSharedIdleTimer() {
  if (localStorage.getItem("study-device-mode") !== "shared") return;
  clearTimeout(state.idleTimer);
  state.idleTimer = setTimeout(async () => {
    sessionStorage.removeItem("study-api-key");
    await deleteCachedCourse();
    location.reload();
  }, SHARED_IDLE_MS);
}

async function forgetCourseAccess() {
  await deleteCachedCourse();
  sessionStorage.removeItem("study-api-key");
  state.pack = null;
  state.chunks = [];
  state.history = [];
  el.settingsModal.close();
  location.reload();
}

async function clearAllData() {
  ["study-api-key", "study-device-mode", "study-model-id", "study-onboarding-complete", "study-theme", "study-text-size", "study-font", "study-contrast"].forEach(
    (key) => localStorage.removeItem(key),
  );
  sessionStorage.clear();
  await deleteCachedCourse();
  state.history = [];
  el.settingsModal.close();
  location.reload();
}

function setMode(mode) {
  state.mode = mode;
  el.modeTabs.forEach((tab) => {
    const active = tab.dataset.mode === mode;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
  const placeholders = {
    ask: "Ask about the selected course material…",
    quiz: "Tell me what kind of practice you want…",
    explain: "Choose a concept, then explain it in your own words…",
  };
  el.messageInput.placeholder = placeholders[mode];
  if (!state.history.length) renderModeWelcome(mode);
}

function renderModeWelcome(mode) {
  if (mode === "ask") {
    el.welcomePanel.hidden = false;
    return;
  }
  el.welcomePanel.hidden = true;
  el.conversation.querySelectorAll(".mode-intro").forEach((node) => node.remove());
  const article = document.createElement("article");
  article.className = "welcome-panel mode-intro";
  if (mode === "quiz") {
    article.innerHTML = `
      <div class="welcome-orbit"><span class="orbit-ring ring-one"></span><span class="orbit-ring ring-two"></span><span class="orbit-core">✓</span></div>
      <p class="eyebrow">Course-only practice</p>
      <h1>Practice without <span>the guesswork.</span></h1>
      <p class="welcome-copy">Ask for recall, explanation, or connection questions. The quiz will draw only from <strong>${escapeHtml(resolveScope().title)}</strong> and will give feedback one question at a time.</p>
      <div class="starter-grid">
        <button class="starter-card" type="button" data-mode-prompt="Begin a balanced five-question practice quiz with a mix of recall and explanation. Ask question 1 only, then wait for my answer."><span class="starter-icon violet">1</span><span><strong>Balanced practice</strong><small>Five questions, delivered one at a time</small></span><span class="starter-arrow">→</span></button>
        <button class="starter-card" type="button" data-mode-prompt="Quiz me one question at a time on concepts that students commonly confuse."><span class="starter-icon teal">2</span><span><strong>Tricky distinctions</strong><small>Focus on similar ideas and common mix-ups</small></span><span class="starter-arrow">→</span></button>
        <button class="starter-card" type="button" data-mode-prompt="Give me an application question that connects ideas across the selected chapters."><span class="starter-icon coral">3</span><span><strong>Connect and apply</strong><small>Practice deeper synthesis</small></span><span class="starter-arrow">→</span></button>
      </div>`;
  } else {
    article.innerHTML = `
      <div class="welcome-orbit"><span class="orbit-ring ring-one"></span><span class="orbit-ring ring-two"></span><span class="orbit-core">↗</span></div>
      <p class="eyebrow">Retrieval practice</p>
      <h1>Teach it to <span>learn it.</span></h1>
      <p class="welcome-copy">Explain a concept in your own words. The companion will compare your explanation with the selected course material, identify what is strong, and coach what is missing.</p>
      <div class="starter-grid">
        <button class="starter-card" type="button" data-mode-prompt="Choose an important concept from this material for me to explain back to you."><span class="starter-icon violet">✦</span><span><strong>Choose for me</strong><small>Get a concept from the selected scope</small></span><span class="starter-arrow">→</span></button>
        <button class="starter-card" type="button" data-mode-prompt="I want to explain the main theme of this material. Prompt me to begin."><span class="starter-icon teal">◎</span><span><strong>Explain the main theme</strong><small>Start broad and then refine</small></span><span class="starter-arrow">→</span></button>
        <button class="starter-card" type="button" data-mode-prompt="Give me two related concepts to compare and explain in my own words."><span class="starter-icon coral">⇄</span><span><strong>Compare concepts</strong><small>Show where your understanding separates them</small></span><span class="starter-arrow">→</span></button>
      </div>`;
  }
  article.querySelectorAll("[data-mode-prompt]").forEach((button) => {
    button.addEventListener("click", () => {
      el.messageInput.value = button.dataset.modePrompt;
      sendCurrentMessage();
    });
  });
  el.conversation.append(article);
}

async function sendCurrentMessage() {
  const message = el.messageInput.value.trim();
  if (!message || state.activeRequest || !state.pack) return;
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    hydrateSetupForm();
    el.setupModal.showModal();
    return;
  }
  const modelId = localStorage.getItem("study-model-id");
  if (!state.pack.models.some((model) => model.id === modelId && isModelWithinCeiling(model))) {
    showToast("Your selected model is no longer in the approved low-cost lineup. Choose another one.");
    hydrateSetupForm();
    el.setupModal.showModal();
    return;
  }

  el.messageInput.value = "";
  autoSizeInput();
  el.welcomePanel.hidden = true;
  el.conversation.querySelectorAll(".mode-intro").forEach((node) => node.remove());
  const userMessageRow = addMessage("user", message);
  state.history.push({ role: "user", content: message });
  const typing = addTypingMessage();
  setRequestState(true);

  try {
    const scope = resolveScope();
    const retrievalQuery = buildRetrievalQuery(message, state.history.slice(0, -1));
    const evidence = retrieveEvidence(retrievalQuery, scope.documentIds, state.chunks);
    const response = await callOpenRouter({ apiKey, modelId, message, evidence, scope });
    typing.remove();
    const validated = validateAssistantResponse(response, evidence);
    addAssistantMessage(validated, evidence);
    state.latestAnswer = validated.answer;
    state.history.push({ role: "assistant", content: validated.answer });
    state.history = state.history.slice(-MAX_HISTORY_TURNS * 2);
  } catch (error) {
    console.error(error);
    typing.remove();
    if (isUnavailableModelError(error)) {
      await recoverFromUnavailableModel({ modelId, message, userMessageRow });
    } else {
      addMessage(
        "assistant",
        `I couldn’t complete that request. ${friendlyRequestError(error)}`,
        { scope: "not_found", label: "Request interrupted" },
      );
    }
  } finally {
    setRequestState(false);
  }
}

async function callOpenRouter({ apiKey, modelId, message, evidence, scope }) {
  const configuredModel = state.pack.models.find((model) => model.id === modelId);
  const sourceText = evidence.length
    ? evidence.map((chunk) => `[SOURCE ${chunk.id} | ${chunk.unitTitle} · ${chunk.documentTitle}]\n${chunk.text}`).join("\n\n")
    : "[NO RELEVANT COURSE SOURCE WAS FOUND]";

  const modeRules = {
    ask: "Answer the student's study question clearly and teach for understanding.",
    quiz: "Act as a quiz coach. Ask exactly ONE question at a time. If the student just answered, give brief evidence-grounded feedback before asking the next question.",
    explain: "Act as an explain-it-back coach. Invite or assess the student's own explanation. Identify what is accurate, what is missing, and one concrete way to improve it. Do not replace their effort with a polished assignment answer.",
  };

  const allowedSourceIds = evidence.length ? evidence.map((chunk) => chunk.id).join("\n") : "(none)";
  const system = `${state.pack.guardrails}\n\n${state.pack.persona}\n\nCURRENT MODE\n${modeRules[state.mode]}\n\nCURRENT STUDY SCOPE\n${scope.title}\n\nCOURSE SOURCES\n${sourceText}\n\nALLOWED SOURCE IDS\n${allowedSourceIds}\n\nRESPONSE CONTRACT\nReturn one JSON object with these exact fields:\n- scope: "in_course", "partial", or "not_found"\n- answer: the student-facing response\n- source_ids: an array containing only IDs copied exactly from ALLOWED SOURCE IDS\nRules: Every factual course claim must be supported by those sources. Copy each source ID exactly, without adding the word SOURCE, brackets, titles, or other text. If sources do not support the answer, set scope to "not_found", explain that the selected course material does not cover it, and use an empty source_ids array. Do not answer from general world knowledge. Never invent a source ID.`;

  const recentHistory = state.history.slice(0, -1).slice(-MAX_HISTORY_TURNS * 2);
  const allowedSourceIdList = evidence.map((chunk) => chunk.id);
  const responseFormat =
    configuredModel?.responseFormat === "json_object"
      ? { type: "json_object" }
      : {
          type: "json_schema",
          json_schema: {
            name: "grounded_study_response",
            strict: true,
            schema: {
              type: "object",
              properties: {
                scope: { type: "string", enum: ["in_course", "partial", "not_found"] },
                answer: { type: "string" },
                source_ids: {
                  type: "array",
                  items: allowedSourceIdList.length
                    ? { type: "string", enum: allowedSourceIdList }
                    : { type: "string" },
                  maxItems: allowedSourceIdList.length ? Math.min(6, allowedSourceIdList.length) : 0,
                  uniqueItems: true,
                },
              },
              required: ["scope", "answer", "source_ids"],
              additionalProperties: false,
            },
          },
        };
  const requestBody = {
    model: modelId,
    messages: [
      { role: "system", content: system },
      ...recentHistory,
      { role: "user", content: message },
    ],
    temperature: 0.25,
    max_tokens: state.pack.modelPolicy.maxOutputTokens,
    response_format: responseFormat,
    provider: {
      data_collection: "deny",
      zdr: true,
      require_parameters: true,
    },
  };

  if (LOW_REASONING_MODELS.has(modelId)) {
    requestBody.reasoning = {
      effort: "low",
      exclude: true,
    };
  }

  const response = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": location.origin,
      "X-OpenRouter-Title": state.pack.app.productName,
    },
    body: JSON.stringify(requestBody),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || `OpenRouter returned ${response.status}`);
    error.name = "OpenRouterRequestError";
    error.status = response.status;
    error.code = payload.error?.code;
    error.modelId = modelId;
    throw error;
  }
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    const error = new Error(
      choice?.finish_reason === "length"
        ? "The model used its response budget before producing a visible answer. Please try again."
        : "The model returned an empty response. Please try again.",
    );
    error.name = "EmptyModelResponseError";
    error.finishReason = choice?.finish_reason;
    throw error;
  }
  return parseJsonResponse(content);
}

function parseJsonResponse(content) {
  if (typeof content === "object") return content;
  try {
    return JSON.parse(content);
  } catch {
    const match = String(content).match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("The approved model did not return the required grounded response format.");
  }
}

function validateAssistantResponse(response, evidence) {
  const allowedScopes = new Set(["in_course", "partial", "not_found"]);
  const allowedIds = new Set(evidence.map((chunk) => chunk.id));
  let sourceIds = Array.isArray(response.source_ids)
    ? [...new Set(response.source_ids.map((value) => normalizeSourceId(value, allowedIds)).filter(Boolean))]
    : [];
  let scope = allowedScopes.has(response.scope) ? response.scope : "not_found";
  let answer = typeof response.answer === "string" ? response.answer.trim() : "";

  if (!answer) {
    scope = "not_found";
    answer = "I could not produce a supported answer from the selected course material.";
  }
  if ((scope === "in_course" || scope === "partial") && !sourceIds.length) {
    sourceIds = inferSupportingSourceIds(answer, evidence);
    if (!sourceIds.length) {
      scope = "not_found";
      answer = "I found a possible answer, but it did not include valid support from the selected course material, so I am not presenting it as course content.";
    }
  }
  return { scope, answer, sourceIds };
}

function normalizeSourceId(value, allowedIds) {
  const raw = typeof value === "string" ? value : value?.id || value?.source_id || "";
  const candidate = String(raw)
    .trim()
    .replace(/^\[?\s*SOURCE\s*:?[\s-]*/i, "")
    .replace(/\]?\s*$/, "")
    .split(/\s*\|\s*/)[0]
    .trim();
  if (allowedIds.has(candidate)) return candidate;
  return [...allowedIds].find((id) => candidate.includes(id)) || "";
}

function addMessage(role, text, meta = null) {
  const row = document.createElement("article");
  row.className = `message-row ${role}`;
  if (role === "assistant") {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = initials(state.pack.companion.name);
    row.append(avatar);
  }
  const content = document.createElement("div");
  content.className = "message-content";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.append(renderSafeText(text));
  content.append(bubble);
  if (meta) {
    const metaRow = document.createElement("div");
    metaRow.className = "message-meta";
    const badge = document.createElement("span");
    badge.className = `scope-badge ${meta.scope.replace("_", "-")}`;
    badge.textContent = meta.label;
    metaRow.append(badge);
    content.append(metaRow);
  }
  row.append(content);
  el.conversation.append(row);
  el.conversation.scrollTop = el.conversation.scrollHeight;
  return row;
}

function addAssistantMessage(response, evidence) {
  const labels = {
    in_course: "✓ Directly supported",
    partial: "◐ Partially covered",
    not_found: "⌁ Not found in this material",
  };
  const row = addMessage("assistant", response.answer, {
    scope: response.scope,
    label: labels[response.scope],
  });
  const meta = row.querySelector(".message-meta");
  response.sourceIds.forEach((id) => {
    const chunk = evidence.find((item) => item.id === id);
    if (!chunk) return;
    const chip = document.createElement("span");
    chip.className = "evidence-chip";
    chip.textContent = `Source · ${chunk.sectionTitle || chunk.documentTitle}`;
    chip.title = `${chunk.unitTitle} · ${chunk.documentTitle}`;
    meta.append(chip);
  });
}

function addTypingMessage() {
  const row = document.createElement("article");
  row.className = "message-row assistant";
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = initials(state.pack.companion.name);
  const content = document.createElement("div");
  content.className = "message-content";
  const bubble = document.createElement("div");
  bubble.className = "message-bubble";
  bubble.innerHTML = '<span class="typing-dots" aria-label="Thinking"><span></span><span></span><span></span></span>';
  content.append(bubble);
  row.append(avatar, content);
  el.conversation.append(row);
  el.conversation.scrollTop = el.conversation.scrollHeight;
  return row;
}

function renderSafeText(text) {
  const fragment = document.createDocumentFragment();
  const blocks = String(text).split(/\n{2,}/);
  blocks.forEach((block) => {
    const lines = block.split("\n").filter(Boolean);
    const isList = lines.every((line) => /^[-*]\s+/.test(line));
    if (isList) {
      const list = document.createElement("ul");
      lines.forEach((line) => {
        const item = document.createElement("li");
        item.textContent = line.replace(/^[-*]\s+/, "");
        list.append(item);
      });
      fragment.append(list);
    } else {
      const paragraph = document.createElement("p");
      paragraph.textContent = lines.join("\n");
      fragment.append(paragraph);
    }
  });
  return fragment;
}

function resetConversation() {
  state.history = [];
  state.latestAnswer = "";
  el.conversation.querySelectorAll(".message-row, .mode-intro").forEach((node) => node.remove());
  if (state.mode === "ask") el.welcomePanel.hidden = false;
  else renderModeWelcome(state.mode);
  showToast("New topic started. The previous conversation was cleared.");
}

function makeStudyNotes() {
  if (!state.history.length) {
    showToast("Study something first, then I can summarize the session.");
    return;
  }
  el.messageInput.value = "Create concise study notes from this session. Organize them by concept and include only claims supported by the selected course material.";
  sendCurrentMessage();
}

function readLatestAnswer() {
  if (!state.latestAnswer) {
    showToast("There is not an answer to read yet.");
    return;
  }
  if (!("speechSynthesis" in window)) {
    showToast("Read-aloud is not supported in this browser.");
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(state.latestAnswer);
  const localVoice = window.speechSynthesis.getVoices().find((voice) => voice.localService && voice.lang.startsWith("en"));
  if (localVoice) utterance.voice = localVoice;
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

function restoreAccessibilityPreferences() {
  const preferredTheme = localStorage.getItem("study-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = preferredTheme;
  el.textSizeSelect.value = localStorage.getItem("study-text-size") || "normal";
  el.fontSelect.value = localStorage.getItem("study-font") || "sans";
  el.contrastToggle.checked = localStorage.getItem("study-contrast") === "high";
  applyAccessibilityPreferences();
}

function applyAccessibilityPreferences() {
  const size = el.textSizeSelect.value;
  const font = el.fontSelect.value;
  const contrast = el.contrastToggle.checked ? "high" : "normal";
  document.documentElement.dataset.textSize = size;
  document.documentElement.dataset.font = font;
  document.documentElement.dataset.contrast = contrast;
  localStorage.setItem("study-text-size", size);
  localStorage.setItem("study-font", font);
  localStorage.setItem("study-contrast", contrast);
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("study-theme", next);
}

function openSidebar() {
  el.sidebar.classList.add("open");
  el.mobileScopeButton.setAttribute("aria-expanded", "true");
  el.sidebarClose.focus();
}

function closeSidebar(returnFocus = false) {
  el.sidebar.classList.remove("open");
  el.mobileScopeButton.setAttribute("aria-expanded", "false");
  if (returnFocus) el.mobileScopeButton.focus();
}

function setRequestState(active) {
  state.activeRequest = active;
  el.sendButton.disabled = active;
  el.messageInput.disabled = active;
}

function autoSizeInput() {
  el.messageInput.style.height = "auto";
  el.messageInput.style.height = `${Math.min(el.messageInput.scrollHeight, 150)}px`;
}

function friendlyRequestError(error) {
  const message = String(error?.message || error);
  if (/401|key|auth/i.test(message)) return "Please check your OpenRouter key in Settings.";
  if (/credit|payment|balance/i.test(message)) return "OpenRouter reports a credit or account issue. Check your OpenRouter dashboard.";
  if (/provider|zdr|data/i.test(message)) return "No privacy-compatible provider is currently available for this approved model. Try another approved model.";
  if (/fetch|network/i.test(message)) return "Check your connection and try again.";
  return message;
}

function isUnavailableModelError(error) {
  const message = String(error?.message || error);
  return (
    Number(error?.status) === 404 ||
    Number(error?.code) === 404 ||
    /unknown model|invalid model|model[^.]*\b(not found|no longer available|deprecated|retired|removed|unavailable)\b|no endpoints found/i.test(
      message,
    )
  );
}

async function recoverFromUnavailableModel({ modelId, message, userMessageRow }) {
  const configuredModel = state.pack.models.find((model) => model.id === modelId);
  const modelName = configuredModel?.displayName || "The selected model";

  state.unavailableModelIds.add(modelId);
  localStorage.removeItem("study-model-id");
  await populateApprovedModels();

  const lastHistoryItem = state.history.at(-1);
  if (lastHistoryItem?.role === "user" && lastHistoryItem.content === message) {
    state.history.pop();
  }
  userMessageRow.remove();
  el.messageInput.value = message;
  autoSizeInput();

  const hasReplacement = [...el.modelSelect.options].some((option) => option.value);
  const explanation = hasReplacement
    ? `${modelName} is no longer available through OpenRouter. Your course, API key, and question are safe. Choose one of the remaining approved low-cost models, save the selection, and then send your waiting question.`
    : `${modelName} is no longer available through OpenRouter, and no other approved model is currently available. Your course, API key, and question are safe. Please let your instructor know that the approved model list needs an update.`;

  addMessage("assistant", explanation);
  hydrateSetupForm();
  if (!el.setupModal.open) el.setupModal.showModal();
}

function showFatalCourseError() {
  el.courseNameTop.textContent = "Course unavailable";
  el.conversation.innerHTML = `
    <article class="welcome-panel">
      <p class="eyebrow">Course pack error</p>
      <h1>This course needs <span>a quick repair.</span></h1>
      <p class="welcome-copy">The encrypted course bundle could not be loaded. No student information was sent anywhere. Please let your instructor know the published course file needs attention.</p>
    </article>`;
  el.sendButton.disabled = true;
  el.messageInput.disabled = true;
}

function showToast(message) {
  el.toast.textContent = message;
  el.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.toast.classList.remove("show"), 3500);
}

async function cacheCoursePack() {
  if (!state.pack || !state.bundle?.bundleId || !("indexedDB" in window)) return;
  try {
    const database = await openCourseDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(COURSE_DB_STORE, "readwrite");
      transaction.objectStore(COURSE_DB_STORE).put({
        id: COURSE_DB_KEY,
        bundleId: state.bundle.bundleId,
        pack: state.pack,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch (error) {
    console.warn("Course access could not be remembered on this browser", error);
  }
}

async function readCachedCourse() {
  if (!("indexedDB" in window)) return null;
  try {
    const database = await openCourseDatabase();
    const result = await new Promise((resolve, reject) => {
      const transaction = database.transaction(COURSE_DB_STORE, "readonly");
      const request = transaction.objectStore(COURSE_DB_STORE).get(COURSE_DB_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return result;
  } catch (error) {
    console.warn("Stored course access could not be read", error);
    return null;
  }
}

async function deleteCachedCourse() {
  if (!("indexedDB" in window)) return;
  try {
    const database = await openCourseDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(COURSE_DB_STORE, "readwrite");
      transaction.objectStore(COURSE_DB_STORE).delete(COURSE_DB_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  } catch (error) {
    console.warn("Stored course access could not be cleared", error);
  }
}

function openCourseDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(COURSE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(COURSE_DB_STORE)) {
        request.result.createObjectStore(COURSE_DB_STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js").catch((error) => console.warn("Service worker registration failed", error));
  }
}

function initials(name) {
  return String(name || "SC")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function toCamel(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
