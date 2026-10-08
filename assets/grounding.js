const DEFAULT_MAX_CHUNK_CHARS = 1500;
const DEFAULT_MAX_CONTEXT_CHUNKS = 15;

const STOP_WORDS = new Set(
  "a an and are as at be because been but by can could did do does for from had has have how i if in into is it its may might more most not of on or our should so than that the their them then there these they this those to too up was we were what when where which who why will with would you your".split(
    " ",
  ),
);

const RETRIEVAL_NOISE_WORDS = new Set(
  "across answer answers application apply ask back balanced begin chapter chapters choose claim claims clear commonly compare concept concepts concise confuse confused connect connects course cover covered create exam explain explanation find five five-question give help idea ideas important include learn learning likely main major map material materials mix notes one only organize overview own please practice prompt question questions quiz recall related review selected session show start student students study summarize summary supported teach tell test time tricky two understand wait want words".split(
    " ",
  ),
);

export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/^'+|'+$/g, "").replace(/'s$/, ""))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

export function buildRetrievalQuery(message, history = []) {
  const meaningfulTerms = tokenize(message).filter((term) => !RETRIEVAL_NOISE_WORDS.has(term));
  if (meaningfulTerms.length >= 2) return message;

  const previousUserMessage = [...history]
    .reverse()
    .find((entry) => entry?.role === "user" && typeof entry.content === "string" && entry.content.trim())?.content;
  return previousUserMessage ? `${previousUserMessage}\n${message}` : message;
}

export function buildChunks(documents, units, { maxChunkChars = DEFAULT_MAX_CHUNK_CHARS } = {}) {
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const chunks = [];

  documents.forEach((document) => {
    const blocks = String(document.content || "")
      .split(/\n\s*\n/)
      .map((block) => block.replace(/[\t ]+/g, " ").trim())
      .filter(Boolean);
    let buffer = "";
    let sectionTitle = document.title;
    let index = 1;

    const flush = () => {
      if (!buffer.trim()) return;
      const text = buffer.trim();
      const terms = tokenize(text);
      const termCounts = new Map();
      terms.forEach((term) => termCounts.set(term, (termCounts.get(term) || 0) + 1));
      const unitTitle = unitMap.get(document.unitId)?.title || document.unitId;
      chunks.push({
        id: `${document.id}-s${index++}`,
        documentId: document.id,
        documentTitle: document.title,
        unitId: document.unitId,
        unitTitle,
        sectionTitle,
        text,
        terms,
        termCounts,
        termSet: new Set(terms),
        headingTerms: new Set(
          tokenize(`${document.title} ${unitTitle} ${sectionTitle} ${(document.keywords || []).join(" ")}`),
        ),
      });
      buffer = "";
    };

    blocks.forEach((block) => {
      const heading = block.match(/^#{1,4}\s+(.+)$/);
      if (heading) {
        flush();
        sectionTitle = heading[1].trim();
        buffer = block;
        return;
      }
      if (buffer.length && buffer.length + block.length + 2 > maxChunkChars) flush();
      buffer += `${buffer ? "\n\n" : ""}${block}`;
    });
    flush();
  });

  return chunks;
}

export function retrieveEvidence(
  query,
  allowedDocumentIds,
  chunks,
  { maxContextChunks = DEFAULT_MAX_CONTEXT_CHUNKS, maxPerDocument = 4 } = {},
) {
  const allowedIds = new Set(allowedDocumentIds);
  const allowed = chunks.filter((chunk) => allowedIds.has(chunk.documentId));
  if (!allowed.length) return [];

  const queryTerms = tokenize(query).filter((term) => !RETRIEVAL_NOISE_WORDS.has(term));
  if (!queryTerms.length) return balancedFallback(allowed, maxContextChunks, maxPerDocument);

  const uniqueQueryTerms = [...new Set(queryTerms)];
  const documentFrequency = new Map();
  uniqueQueryTerms.forEach((term) => {
    documentFrequency.set(term, allowed.filter((chunk) => chunk.termSet.has(term)).length);
  });
  const averageLength = allowed.reduce((total, chunk) => total + chunk.terms.length, 0) / allowed.length || 1;

  const scored = allowed.map((chunk) => {
    let score = 0;
    uniqueQueryTerms.forEach((term) => {
      const frequency = chunk.termCounts.get(term) || 0;
      if (!frequency) return;
      const frequencyAcrossChunks = documentFrequency.get(term) || 0;
      const inverseFrequency = Math.log(1 + (allowed.length - frequencyAcrossChunks + 0.5) / (frequencyAcrossChunks + 0.5));
      const lengthAdjustment = 1.2 * (0.25 + 0.75 * (chunk.terms.length / averageLength));
      score += inverseFrequency * ((frequency * 2.2) / (frequency + lengthAdjustment));
      if (chunk.headingTerms.has(term)) score += inverseFrequency * 1.4;
    });
    return { ...chunk, score };
  });

  const positive = scored.filter((chunk) => chunk.score > 0).sort((left, right) => right.score - left.score);
  if (!positive.length) return [];
  const relevanceFloor = positive.length ? Math.max(0.75, positive[0].score * 0.18) : 0;
  const relevant = positive.filter((chunk) => chunk.score >= relevanceFloor);
  return selectDiversified(relevant, maxContextChunks, maxPerDocument);
}

export function inferSupportingSourceIds(answer, evidence) {
  const answerTerms = new Set(tokenize(answer));
  if (!answerTerms.size) return [];

  const ranked = evidence
    .map((chunk) => {
      let overlap = 0;
      answerTerms.forEach((term) => {
        if (chunk.termSet.has(term)) overlap += 1;
      });
      return { id: chunk.id, overlap, coverage: overlap / answerTerms.size };
    })
    .filter((item) => item.overlap >= 4 && item.coverage >= 0.08)
    .sort((left, right) => right.overlap - left.overlap || right.coverage - left.coverage);

  if (!ranked.length) return [];
  const relativeThreshold = Math.max(4, Math.ceil(ranked[0].overlap * 0.6));
  return ranked
    .filter((item) => item.overlap >= relativeThreshold)
    .slice(0, 2)
    .map((item) => item.id);
}

function selectDiversified(chunks, limit, maxPerDocument) {
  const documentCount = new Set(chunks.map((chunk) => chunk.documentId)).size;
  const effectiveMax = Math.max(maxPerDocument, Math.ceil(limit / Math.max(1, documentCount)));
  const selected = [];
  const perDocument = new Map();

  for (const chunk of chunks) {
    const count = perDocument.get(chunk.documentId) || 0;
    if (count >= effectiveMax) continue;
    selected.push(chunk);
    perDocument.set(chunk.documentId, count + 1);
    if (selected.length >= limit) break;
  }
  return selected;
}

function balancedFallback(chunks, limit, maxPerDocument) {
  const groups = new Map();
  chunks.forEach((chunk) => {
    if (!groups.has(chunk.documentId)) groups.set(chunk.documentId, []);
    groups.get(chunk.documentId).push(chunk);
  });

  const groupList = [...groups.values()];
  const effectiveMax = Math.max(maxPerDocument, Math.ceil(limit / Math.max(1, groupList.length)));
  const selected = [];
  for (let position = 0; selected.length < limit && position < effectiveMax; position += 1) {
    for (const group of groupList) {
      if (group[position]) selected.push(group[position]);
      if (selected.length >= limit) break;
    }
  }
  for (const chunk of chunks) {
    if (!selected.includes(chunk)) selected.push(chunk);
    if (selected.length >= limit) break;
  }
  return selected;
}
