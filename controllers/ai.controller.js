const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const ApiResponse = require('../utils/ApiResponse');
const AiInsight = require('../models/AiInsight');
const AiChat = require('../models/AiChat');
const { buildFacts } = require('../utils/ai/farmFacts');
const { generate, generateStream } = require('../utils/ai/gemini');
const { chatSystem, summarySystem, SUMMARY_SCHEMA } = require('../utils/ai/prompts');
const {
  SUGGESTED_PROMPTS, GAP_TIPS, DRIVER_TITLES, welcomeMessage, summaryMetrics, driverTags, driverStatus, fallbackSummary, fallbackChat,
} = require('../utils/ai/advisorText');

const CACHE_HOURS = Number(process.env.AI_CACHE_HOURS || 6);
const HISTORY_SENT = 12; // past messages sent back to Gemini with each question
const log = (...a) => (process.env.AI_DEBUG === 'true' ? console.log('[ai]', ...a) : undefined);

// Phone numbers, emails and long account numbers never go to Gemini.
const scrub = (text) =>
  String(text || '')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
    .replace(/(\+?63|0)9\d{2}[\s-]?\d{3}[\s-]?\d{4}/g, '[phone]')
    .replace(/\b\d{10,}\b/g, '[number]');

const periodLabel = (facts) => `${facts.money.last30Days.from} – ${facts.money.last30Days.to}`;

function assertFarmer(user) {
  if (user.role !== 'user') throw ApiError.forbidden('The AI Farm Advisor is for farmer accounts');
}

// GET /api/ai/advisor
// What the AI Advisor page and widget show before any question: a welcome
// message built from the farmer's own numbers, suggested questions, and the
// crops that fit this season. No AI call, so it's instant and costs no quota.
async function getAdvisor(req, res) {
  assertFarmer(req.user);
  const { facts } = await buildFacts(req.user);
  new ApiResponse(200, {
    welcomeMessage: welcomeMessage(req.user.firstName, facts),
    suggestedPrompts: SUGGESTED_PROMPTS,
    location: facts.location,
    season: facts.season,
    weather: facts.weather,
    cropRecommendations: facts.cropRecommendations.map(({ reasons, ...c }) => c),
    dataGaps: facts.dataGaps,
    dataNotes: facts.dataNotes,
  }).send(res);
}

// GET /api/ai/summary?refresh=1
// The AI Financial Summary page. Numbers (metrics, tags) are computed here;
// Gemini writes the sentences. Saved for a few hours per farmer.
async function getSummary(req, res) {
  assertFarmer(req.user);
  const { facts } = await buildFacts(req.user);
  const dataHash = crypto.createHash('sha1').update(JSON.stringify({ day: facts.today, money: facts.money, cycles: facts.cropCycles, budget: facts.budget, loans: facts.loans })).digest('hex');

  if (req.query.refresh !== '1') {
    const hit = await AiInsight.findOne({ user: req.user._id, kind: 'summary', dataHash, expiresAt: { $gt: new Date() } }).lean();
    if (hit) return new ApiResponse(200, { ...hit.payload, cached: true }).send(res);
  }

  let text;
  let source = 'gemini';
  try {
    const { data } = await generate({ system: summarySystem(), prompt: `FACTS:\n${JSON.stringify(facts)}`, jsonSchema: SUMMARY_SCHEMA, temperature: 0.3 });
    text = data;
  } catch (err) {
    log('summary fallback:', err.cause?.message || err.message);
    text = fallbackSummary(facts);
    source = 'rules';
  }

  const tags = driverTags(facts);
  const status = driverStatus(facts);
  const fallbackText = source === 'rules' ? text : fallbackSummary(facts);
  const payload = {
    period: periodLabel(facts),
    generatedAt: new Date().toISOString(),
    source,
    narrative: Array.isArray(text.narrative) && text.narrative.length ? text.narrative : fallbackText.narrative,
    metrics: summaryMetrics(facts),
    drivers: Object.keys(DRIVER_TITLES).map((key) => ({
      key,
      title: DRIVER_TITLES[key],
      status: status[key],
      text: text.drivers?.find((d) => d.key === key)?.text || fallbackText.drivers.find((d) => d.key === key).text,
      tags: tags[key],
    })),
    focusRecommendation: text.focusRecommendation || fallbackText.focusRecommendation,
    // what the farmer could record to make the summary better
    tips: facts.dataGaps.map((g) => GAP_TIPS[g]).filter(Boolean),
  };

  // Only AI-written summaries are saved, so a rules-only answer is retried next time.
  if (source === 'gemini') {
    await AiInsight.findOneAndUpdate(
      { user: req.user._id, kind: 'summary' },
      { dataHash, payload, expiresAt: new Date(Date.now() + CACHE_HOURS * 3600 * 1000) },
      { upsert: true }
    );
  }
  new ApiResponse(200, { ...payload, cached: false }).send(res);
}

// GET /api/ai/chat
async function getChatHistory(req, res) {
  assertFarmer(req.user);
  const chat = await AiChat.findOne({ user: req.user._id }).lean();
  new ApiResponse(200, { messages: (chat?.messages || []).slice(-50) }).send(res);
}

// DELETE /api/ai/chat
async function clearChatHistory(req, res) {
  assertFarmer(req.user);
  await AiChat.deleteOne({ user: req.user._id });
  new ApiResponse(200, { messages: [] }, 'Conversation cleared').send(res);
}

// POST /api/ai/chat  { message }
// Streams the answer as plain text while Gemini writes it. If Gemini can't
// answer (no key, free quota used up, timeout), a rule-based answer built from
// the farmer's numbers is sent instead, so the farmer always gets a reply.
async function chat(req, res) {
  assertFarmer(req.user);
  const question = req.body.message;
  const { facts } = await buildFacts(req.user);
  const saved = await AiChat.findOne({ user: req.user._id }).lean();
  const history = (saved?.messages || []).slice(-HISTORY_SENT).map((m) => ({ role: m.role, parts: [{ text: scrub(m.text) }] }));

  const abort = new AbortController();
  res.on('close', () => { if (!res.writableFinished) abort.abort(); });
  res.status(200);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  // no-transform stops the compression middleware from holding the stream back
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-AI-Source', 'gemini');
  res.flushHeaders();

  let reply = '';
  let source = 'gemini';
  try {
    for await (const piece of generateStream({ system: chatSystem(facts), prompt: scrub(question), history, signal: abort.signal })) {
      const clean = piece.replace(/\*\*|__|^#+\s/gm, ''); // plain text only, even if the model slips into markdown
      reply += clean;
      res.write(clean);
    }
  } catch (err) {
    log('chat fallback:', err.cause?.message || err.message);
    if (!reply) {
      source = 'rules';
      reply = fallbackChat(facts, question);
      res.write(reply);
    }
  }
  res.end();

  if (reply && !abort.signal.aborted) {
    await AiChat.findOneAndUpdate(
      { user: req.user._id },
      { $push: { messages: { $each: [{ role: 'user', text: question }, { role: 'model', text: reply.slice(0, 8000) }], $slice: -100 } } },
      { upsert: true }
    ).catch((err) => console.error('[ai] could not save chat', err.message));
  }
  log('chat answered from', source);
}

module.exports = { getAdvisor, getSummary, getChatHistory, clearChatHistory, chat };
