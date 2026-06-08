// LLM interface for the SCOPE and SYNTHESIZE stages. The provider is the Nous Portal
// (src/research/providers/nous.mjs); the pipeline injects an `llm` satisfying this
// contract. The llm is REQUIRED — there is no fallback, so scope/synthesis throw when
// it is absent or fails (the I/O is injected only to keep the stages unit-testable).
//
// Contract an LLM impl must satisfy:
//   llm.json({ system, user, schemaHint }) → Promise<object>   // returns parsed JSON
//
// Security (§7): retrieved third-party text is UNTRUSTED and may carry prompt
// injection. Callers must pass it as `user` *data*, never fold it into `system`
// instructions, and every model output is schema-validated downstream.

/**
 * Wrap a raw text-completion function into the json() contract, parsing a JSON
 * object out of the model's reply (tolerates ```json fences / surrounding prose).
 */
export function makeJsonLlm(complete) {
  return {
    async json({ system, user, schemaHint }) {
      const text = await complete({ system, user, schemaHint });
      return extractJson(text);
    },
  };
}

/** Pull the first balanced JSON object/array out of a model reply. Throws if none. */
export function extractJson(text) {
  if (typeof text === 'object') return text; // already parsed
  if (typeof text !== 'string') throw new Error('llm: non-string completion');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) throw new Error('llm: no JSON found in completion');
  // Walk to the matching close bracket, respecting strings/escapes.
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') inStr = !inStr;
    else if (!inStr && ch === open) depth++;
    else if (!inStr && ch === close && --depth === 0) {
      return JSON.parse(body.slice(start, i + 1));
    }
  }
  throw new Error('llm: unbalanced JSON in completion');
}
