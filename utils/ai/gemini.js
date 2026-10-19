// Thin wrapper around Google's Gemini API (free tier from Google AI Studio).
// - Model names come from env vars, so you can switch when Google renames models.
// - On quota (429), unknown model (404), server errors or timeouts it tries the
//   next model, then throws AiUnavailableError so the caller can answer from the
//   rules instead.
//
// Settings (env vars, all optional):
//   GEMINI_MODEL            first model to try          (default gemini-3.1-flash-lite)
//   GEMINI_FALLBACK_MODELS  comma-separated backups     (default gemini-3.5-flash-lite)
//   GEMINI_THINKING_LEVEL   MINIMAL | LOW | MEDIUM | HIGH, Gemini 3 models only (default HIGH, as set
//                           in AI Studio; LOW answers faster)
//   AI_CHAT_WEB_SEARCH      chat may search Google, as set in AI Studio (default true; set false
//                           to save free quota)
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
  const primary = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash-lite').split(',').map((s) => s.trim()).filter(Boolean);
  return [...new Set([primary, ...fallbacks])];
}

// Gemini 3 models take a thinking *level*; older 2.5 models reject it, so it is only sent to Gemini 3.
function thinkingFor(model) {
  if (!/^gemini-3/.test(model)) return {};
  const level = String(process.env.GEMINI_THINKING_LEVEL || 'HIGH').toUpperCase();
  return ['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(level) ? { thinkingConfig: { thinkingLevel: level } } : {};
}

const SEARCH_RETRY = [400, 429];

const retryable = (err) =>
  [404, 429, 500, 503, 504].includes(err?.status) || err?.name === 'TimeoutError' || err?.name === 'AbortError' || err instanceof SyntaxError;

class AiUnavailableError extends Error {
  constructor(cause) {
    super('AI service unavailable');
    this.name = 'AiUnavailableError';
    this.cause = cause;
  }
}

/** One answer. With `jsonSchema`, returns the parsed object in `data`. */
async function generate({ system, prompt, history = [], jsonSchema, temperature = 0.4, timeoutMs = 50000, webSearch = false }) {
  const ai = getClient();
  if (!ai) throw new AiUnavailableError(new Error('GEMINI_API_KEY is not set'));
  const call = (model, withSearch) =>
    ai.models.generateContent({
      model,
      contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
      config: {
        systemInstruction: system,
        temperature,
        abortSignal: AbortSignal.timeout(timeoutMs),
        ...thinkingFor(model),
        ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
        ...(jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: jsonSchema } : {}),
      },
    });
  let lastErr;
  for (const model of modelChain()) {
    try {
      let res;
      try {
        res = await call(model, webSearch);
      } catch (err) {
        // Google Search has its own (small) free quota (429), and some models refuse Search together
        // with a JSON answer (400). Either way, ask again without Search: the farmer's records are enough.
        if (!(webSearch && SEARCH_RETRY.includes(err?.status))) throw err;
        res = await call(model, false);
      }
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
async function* generateStream({ system, prompt, history = [], temperature = 0.5, timeoutMs = 60000, signal, webSearch = process.env.AI_CHAT_WEB_SEARCH !== 'false' }) {
  const ai = getClient();
  if (!ai) throw new AiUnavailableError(new Error('GEMINI_API_KEY is not set'));
  let lastErr;
  for (const model of modelChain()) {
    // First with Google Search (if on); if Search is out of quota or refused, the same model again without it.
    for (const withSearch of webSearch ? [true, false] : [false]) {
      let started = false;
      try {
        const abortSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
        const stream = await ai.models.generateContentStream({
          model,
          contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
          config: {
            systemInstruction: system,
            temperature,
            abortSignal,
            ...thinkingFor(model),
            ...(withSearch ? { tools: [{ googleSearch: {} }] } : {}),
          },
        });
        for await (const chunk of stream) {
          if (chunk.text) { started = true; yield chunk.text; }
        }
        return;
      } catch (err) {
        lastErr = err;
        if (started) throw new AiUnavailableError(err); // can't restart halfway through an answer
        if (withSearch && SEARCH_RETRY.includes(err?.status)) continue; // try again without Search
        break;
      }
    }
    if (!retryable(lastErr)) break;
  }
  throw new AiUnavailableError(lastErr);
}

module.exports = { generate, generateStream, AiUnavailableError, modelChain, thinkingFor, setClientForTests };
