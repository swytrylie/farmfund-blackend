// Thin wrapper around Google's Gemini API (free tier from Google AI Studio).
// - Model names come from env vars, so you can switch when Google renames models.
// - On quota (429), server errors or timeouts it tries the next model, then
//   throws AiUnavailableError so the caller can answer from the rules instead.
const { GoogleGenAI } = require('@google/genai');

let client = null;
function getClient() {
  if (client) return client;
  if (!process.env.GEMINI_API_KEY) return null;
  client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  return client;
}
/** Tests only: swap in a fake client. */
function setClientForTests(c) { client = c; }

function modelChain() {
  const primary = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-2.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

const retryable = (err) =>
  [429, 500, 503, 504].includes(err?.status) || err?.name === 'TimeoutError' || err?.name === 'AbortError' || err instanceof SyntaxError;

class AiUnavailableError extends Error {
  constructor(cause) {
    super('AI service unavailable');
    this.name = 'AiUnavailableError';
    this.cause = cause;
  }
}

/** One answer. With `jsonSchema`, returns the parsed object in `data`. */
async function generate({ system, prompt, history = [], jsonSchema, temperature = 0.4, timeoutMs = 25000 }) {
  const ai = getClient();
  if (!ai) throw new AiUnavailableError(new Error('GEMINI_API_KEY is not set'));
  let lastErr;
  for (const model of modelChain()) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: system,
          temperature,
          abortSignal: AbortSignal.timeout(timeoutMs),
          ...(jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: jsonSchema } : {}),
        },
      });
      const text = res.text || '';
      return { model, text, data: jsonSchema ? JSON.parse(text) : undefined };
    } catch (err) {
      lastErr = err;
      if (!retryable(err)) break;
    }
  }
  throw new AiUnavailableError(lastErr);
}

/** Streaming answer for the chatbot: yields text pieces as they arrive. */
async function* generateStream({ system, prompt, history = [], temperature = 0.5, timeoutMs = 45000, signal }) {
  const ai = getClient();
  if (!ai) throw new AiUnavailableError(new Error('GEMINI_API_KEY is not set'));
  let lastErr;
  for (const model of modelChain()) {
    let started = false;
    try {
      const abortSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
      const stream = await ai.models.generateContentStream({
        model,
        contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
        config: { systemInstruction: system, temperature, abortSignal },
      });
      for await (const chunk of stream) {
        if (chunk.text) { started = true; yield chunk.text; }
      }
      return;
    } catch (err) {
      lastErr = err;
      if (started || !retryable(err)) break; // can't switch models halfway through an answer
    }
  }
  throw new AiUnavailableError(lastErr);
}

module.exports = { generate, generateStream, AiUnavailableError, modelChain, setClientForTests };
