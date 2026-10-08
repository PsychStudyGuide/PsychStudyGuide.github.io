import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

import { encryptCoursePack, generateCourseCode } from "../assets/course-crypto.js";

const nativeSetTimeout = globalThis.setTimeout;

test("student flow unlocks, configures privacy, and renders grounded answers", { timeout: 20_000 }, async () => {
  const fixture = await loadCourseFixture();
  const html = await readFile(resolve("index.html"), "utf8");
  const dom = new JSDOM(html, { url: "http://localhost:8080/", pretendToBeVisual: true });
  const { window } = dom;
  const chatRequests = [];

  installBrowserGlobals(window);
  installDialogPolyfill(window);
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith("course/course.bundle.json")) return jsonResponse(fixture.bundle);
    if (url === "https://openrouter.ai/api/v1/models") {
      return jsonResponse({
        data: [
          { id: "google/gemini-2.5-flash-lite", pricing: { prompt: "0.0000001", completion: "0.0000004" } },
          { id: "openai/gpt-oss-20b", pricing: { prompt: "0.000000018", completion: "0.00000009" } },
          { id: "qwen/qwen3.5-flash-02-23", pricing: { prompt: "0.000000065", completion: "0.00000026" } },
        ],
      });
    }
    if (url === "https://openrouter.ai/api/v1/chat/completions") {
      const body = JSON.parse(options.body);
      chatRequests.push({ body, headers: options.headers });
      const system = body.messages[0].content;
      const userMessage = body.messages.at(-1).content;
      const sources = parseSources(system);
      const isQuiz = userMessage.startsWith("Begin a balanced five-question practice quiz");
      const isUnsupported = sources.length === 0;
      const preferredSource = isQuiz
        ? sources.find((source) => /Wundt|biological, cognitive/i.test(source.text))
        : sources.find((source) => /Clinical psychology studies/i.test(source.text));
      const sourceId = (preferredSource || sources[0])?.id;
      const answer = isUnsupported
        ? "The selected course material does not cover attachment styles."
        : isQuiz
          ? "Question 1 of 5: How does cognitive psychology differ from biological psychology?"
          : "Clinical psychology centers on psychological disorders and their treatment. Counseling psychology often helps people adjust to difficult life events such as bereavement or divorce.";
      return jsonResponse({
        choices: [
          {
            finish_reason: "stop",
            message: {
              content: JSON.stringify({
                scope: isUnsupported ? "not_found" : "in_course",
                answer,
                source_ids: sourceId ? [sourceId] : [],
              }),
            },
          },
        ],
      });
    }
    throw new Error(`Unexpected fetch in integration test: ${url}`);
  };

  try {
    const appUrl = `${pathToFileURL(resolve("assets/app.js")).href}?integration=${Date.now()}`;
    await import(appUrl);
    window.document.dispatchEvent(new window.Event("DOMContentLoaded", { bubbles: true }));

    await waitFor(() => window.document.getElementById("course-access-modal").open);
    assert.equal(window.document.getElementById("access-course-title").textContent, "Unlock General Psychology");

    window.document.getElementById("course-code-input").value = fixture.code;
    window.document.getElementById("unlock-course-button").click();
    await waitFor(() => window.document.getElementById("onboarding-modal").open, 10_000);

    assert.equal(window.document.getElementById("course-name-top").textContent, "General Psychology");
    assert.match(window.document.getElementById("funding-notice-text").textContent, /educational resource funds/i);
    assert.equal(window.document.getElementById("scope-select").value, "set:chapter-1-review");

    const acknowledgement = window.document.getElementById("funding-acknowledgement");
    acknowledgement.checked = true;
    acknowledgement.dispatchEvent(new window.Event("change", { bubbles: true }));
    window.document.getElementById("begin-setup-button").click();
    await waitFor(() => window.document.getElementById("setup-modal").open);

    const modelSelect = window.document.getElementById("model-select");
    assert.deepEqual(
      [...modelSelect.options].map((option) => option.value),
      ["google/gemini-2.5-flash-lite", "openai/gpt-oss-20b", "qwen/qwen3.5-flash-02-23"],
    );
    window.document.getElementById("api-key-input").value = "sk-or-v1-integration-test";
    window.document.getElementById("save-setup-button").click();
    await waitFor(() => !window.document.getElementById("setup-modal").open);

    window.document.getElementById("mobile-scope-button").click();
    assert.equal(window.document.getElementById("sidebar").classList.contains("open"), true);
    assert.equal(window.document.getElementById("mobile-scope-button").getAttribute("aria-expanded"), "true");
    window.document.getElementById("sidebar-close").click();
    assert.equal(window.document.getElementById("sidebar").classList.contains("open"), false);
    assert.equal(window.document.getElementById("mobile-scope-button").getAttribute("aria-expanded"), "false");

    const composer = window.document.getElementById("message-input");
    composer.value = "How are clinical and counseling psychology different?";
    window.document.getElementById("send-button").click();
    await waitFor(
      () =>
        chatRequests.length === 1 &&
        window.document.querySelector(".message-row.assistant .message-bubble")?.textContent.includes("Clinical psychology centers"),
    );

    const firstRequest = chatRequests[0].body;
    assert.equal(firstRequest.provider.data_collection, "deny");
    assert.equal(firstRequest.provider.zdr, true);
    assert.equal(firstRequest.provider.require_parameters, true);
    assert.equal(firstRequest.response_format.type, "json_schema");
    assert.equal(firstRequest.response_format.json_schema.strict, true);
    assert.deepEqual(
      firstRequest.response_format.json_schema.schema.properties.source_ids.items.enum,
      [...firstRequest.messages[0].content.matchAll(/\[SOURCE ([^\s|]+) \|/g)].map((match) => match[1]),
    );
    assert.match(firstRequest.messages[0].content, /## Helping professions/);
    assert.doesNotMatch(firstRequest.messages[0].content, /## Freud and the unconscious mind/);
    assert.match(window.document.querySelector(".message-row.assistant .message-bubble").textContent, /Clinical psychology centers/);
    assert.match(window.document.querySelector(".evidence-chip").textContent, /Helping professions/);
    assert.match(window.document.querySelector(".scope-badge").textContent, /Directly supported/);

    window.document.getElementById("new-topic-button").click();
    window.document.querySelector('[data-mode="quiz"]').click();
    const balancedQuizButton = window.document.querySelector('.mode-intro [data-mode-prompt^="Begin a balanced"]');
    assert.ok(balancedQuizButton);
    balancedQuizButton.click();
    await waitFor(
      () =>
        chatRequests.length === 2 &&
        window.document.querySelector(".message-row.assistant .message-bubble")?.textContent.includes("Question 1 of 5"),
    );

    const quizRequest = chatRequests[1].body;
    assert.match(quizRequest.messages[0].content, /Ask exactly ONE question at a time/);
    assert.match(quizRequest.messages.at(-1).content, /Ask question 1 only/);
    const quizAnswer = window.document.querySelector(".message-row.assistant .message-bubble").textContent;
    assert.equal((quizAnswer.match(/\?/g) || []).length, 1);

    window.document.getElementById("new-topic-button").click();
    window.document.querySelector('[data-mode="ask"]').click();
    composer.value = "What are the attachment styles?";
    window.document.getElementById("send-button").click();
    await waitFor(
      () =>
        chatRequests.length === 3 &&
        window.document.querySelector(".message-row.assistant .message-bubble")?.textContent.includes("does not cover attachment styles"),
    );

    const unsupportedRequest = chatRequests[2].body;
    assert.match(unsupportedRequest.messages[0].content, /NO RELEVANT COURSE SOURCE WAS FOUND/);
    assert.equal(unsupportedRequest.response_format.json_schema.schema.properties.source_ids.maxItems, 0);
    assert.match(window.document.querySelector(".scope-badge").textContent, /Not found in this material/);
  } finally {
    dom.window.close();
  }
});

async function loadCourseFixture() {
  if (process.env.DEMO_PACK_PATH && process.env.DEMO_CODE_FILE) {
    const pack = JSON.parse(await readFile(resolve(process.env.DEMO_PACK_PATH), "utf8"));
    const codeText = await readFile(resolve(process.env.DEMO_CODE_FILE), "utf8");
    const code = codeText.match(/\b[A-Z0-9]{5}(?:-[A-Z0-9]{5}){3}\b/i)?.[0];
    const bundle = JSON.parse(await readFile(resolve("course/course.bundle.json"), "utf8"));
    return { pack, code, bundle };
  }

  const code = generateCourseCode();
  const pack = {
    app: { productName: "Study Companion" },
    course: {
      id: "general-psychology",
      title: "General Psychology",
      instructor: "Professor Andrea",
      welcomeHeading: "Study the course.",
      welcomeAccent: "Not the entire internet.",
      defaultScope: "set:chapter-1-review",
      theme: {},
    },
    companion: { name: "Study Companion" },
    fundingNotice: {
      text: "This is an optional study aid. College educational resource funds may not be used to purchase OpenRouter credits or cover related costs.",
    },
    modelPolicy: { maxPromptPerMillion: 0.15, maxCompletionPerMillion: 0.6, maxOutputTokens: 850 },
    models: [
      { id: "google/gemini-2.5-flash-lite", label: "Fast", displayName: "Gemini 2.5 Flash Lite", description: "Fast" },
      { id: "openai/gpt-oss-20b", label: "Careful", displayName: "GPT OSS 20B", description: "Careful" },
      { id: "qwen/qwen3.5-flash-02-23", label: "Balanced", displayName: "Qwen 3.5 Flash", description: "Balanced" },
    ],
    units: [
      { id: "subfields", title: "1.1 Psychological Subfields and Major Themes", order: 1 },
      { id: "history", title: "1.2 A Brief History of Psychology", order: 2 },
    ],
    studySets: [{ id: "chapter-1-review", title: "Chapter 1 Review", unitIds: ["subfields", "history"] }],
    documents: [
      {
        id: "subfields-lecture",
        unitId: "subfields",
        title: "Lecture 1",
        content: "## Biological, cognitive, and experimental psychology\n\nCognitive psychology studies thinking and learning. Biological psychology studies the brain and nervous system.\n\n## Helping professions\n\nClinical psychology studies psychological disorders and treatment. Counseling psychology helps people adjust to difficult life events such as bereavement or divorce.",
      },
      {
        id: "history-lecture",
        unitId: "history",
        title: "Lecture 2",
        content: "## Wundt and introspection\n\nWilhelm Wundt studied memory and selective attention using introspection.",
      },
    ],
    persona: "Be a warm, direct teaching assistant.",
    guardrails: "Use only supplied course sources and never invent claims.",
  };
  return { pack, code, bundle: await encryptCoursePack(pack, code) };
}

function installBrowserGlobals(window) {
  const globals = [
    "window",
    "document",
    "navigator",
    "location",
    "localStorage",
    "sessionStorage",
    "HTMLElement",
    "HTMLDialogElement",
    "Node",
    "Event",
    "CustomEvent",
  ];
  globals.forEach((name) => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: name === "window" ? window : window[name],
    });
  });
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.matchMedia = matchMedia;
  globalThis.matchMedia = matchMedia;
  window.scrollTo = () => {};
  const unrefTimeout = (...args) => {
    const timer = nativeSetTimeout(...args);
    timer.unref?.();
    return timer;
  };
  globalThis.setTimeout = unrefTimeout;
}

function installDialogPolyfill(window) {
  const prototype = window.HTMLDialogElement.prototype;
  prototype.showModal = function showModal() {
    this.open = true;
    this.setAttribute("open", "");
  };
  prototype.close = function close() {
    this.open = false;
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };
}

function parseSources(systemPrompt) {
  const sources = [];
  const pattern = /\[SOURCE ([^\s|]+) \|[^\]]+\]\n([\s\S]*?)(?=\n\n\[SOURCE |\n\nALLOWED SOURCE IDS)/g;
  for (const match of systemPrompt.matchAll(pattern)) sources.push({ id: match[1], text: match[2] });
  return sources;
}

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function waitFor(predicate, timeout = 5000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeout) throw new Error("Timed out waiting for the browser state to update.");
    await new Promise((resolvePromise) => nativeSetTimeout(resolvePromise, 10));
  }
}
