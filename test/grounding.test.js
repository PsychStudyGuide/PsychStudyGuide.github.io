import test from "node:test";
import assert from "node:assert/strict";

import {
  buildChunks,
  buildRetrievalQuery,
  inferSupportingSourceIds,
  retrieveEvidence,
  tokenize,
} from "../assets/grounding.js";

const units = [
  { id: "subfields", title: "Psychological Subfields and Major Themes" },
  { id: "history", title: "A Brief History of Psychology" },
];

const documents = [
  {
    id: "subfields-lecture",
    unitId: "subfields",
    title: "Lecture 1: Subfields and Major Themes",
    keywords: ["clinical", "counseling", "nature", "nurture"],
    content: `## Clinical and counseling psychology\n\nClinical psychology studies factors that cause psychological disorders and methods used to treat them. Counseling psychology helps people manage difficult life circumstances and improve daily life.\n\n## Major themes\n\nThe nature-nurture theme asks how genes and the environment contribute to behavior. The person-situation theme asks how behavior reflects individual choices and surrounding circumstances.`,
  },
  {
    id: "history-lecture",
    unitId: "history",
    title: "Lecture 2: History of Psychology",
    keywords: ["Wundt", "Watson", "behaviorism", "cognitive"],
    content: `## Wilhelm Wundt and voluntarism\n\nWilhelm Wundt opened the first experimental psychology laboratory. He studied memory and selective attention using introspection.\n\n## Behaviorism and the cognitive shift\n\nJohn B. Watson argued that psychology should study observable behavior. Cognitive psychologists later argued that mental functions such as memory and decision making also influence behavior.`,
  },
];

const chunks = buildChunks(documents, units, { maxChunkChars: 500 });

test("tokenize normalizes punctuation and removes common stop words", () => {
  assert.deepEqual(tokenize("What is Wundt's role in Psychology?"), ["wundt", "role", "psychology"]);
});

test("specific questions retrieve the correct lecture section", () => {
  const evidence = retrieveEvidence("How are clinical and counseling psychology different?", documents.map((doc) => doc.id), chunks);
  assert.equal(evidence[0].documentId, "subfields-lecture");
  assert.equal(evidence[0].sectionTitle, "Clinical and counseling psychology");
});

test("history questions prioritize the named figure", () => {
  const evidence = retrieveEvidence("What did Wilhelm Wundt study?", documents.map((doc) => doc.id), chunks);
  assert.equal(evidence[0].sectionTitle, "Wilhelm Wundt and voluntarism");
});

test("generic study requests fall back across documents", () => {
  const evidence = retrieveEvidence("Begin a balanced five-question practice quiz.", documents.map((doc) => doc.id), chunks);
  assert.deepEqual(new Set(evidence.map((chunk) => chunk.documentId)), new Set(documents.map((doc) => doc.id)));
});

test("off-topic questions return no evidence instead of unrelated fallback chunks", () => {
  const evidence = retrieveEvidence("What are the attachment styles?", documents.map((doc) => doc.id), chunks);
  assert.deepEqual(evidence, []);
});

test("short follow-ups carry the previous user topic into retrieval", () => {
  const query = buildRetrievalQuery("Why?", [{ role: "user", content: "Why did behaviorism become influential?" }]);
  const evidence = retrieveEvidence(query, documents.map((doc) => doc.id), chunks);
  assert.equal(evidence[0].sectionTitle, "Behaviorism and the cognitive shift");
});

test("citation recovery only returns evidence with meaningful overlap", () => {
  const evidence = retrieveEvidence("What did Wilhelm Wundt study?", documents.map((doc) => doc.id), chunks);
  const ids = inferSupportingSourceIds(
    "Wilhelm Wundt studied memory and selective attention and used introspection.",
    evidence,
  );
  assert.deepEqual(ids, [evidence[0].id]);
});
