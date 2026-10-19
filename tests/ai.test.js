// Tests for the AI Farm Advisor (routes/ai.routes.js).
// Run with: npm test
//
// No database is needed: the Mongoose model methods the advisor calls are
// replaced with in-memory fixtures, and Gemini is replaced with a fake client.
process.env.JWT_ACCESS_SECRET = 'test-secret';
delete process.env.GEMINI_API_KEY;

const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const mongoose = require('mongoose');
const { generateAccessToken } = require('../utils/jwt');
const errorHandler = require('../middleware/errorHandler');
const { setClientForTests, thinkingFor, modelChain } = require('../utils/ai/gemini');
const { recommendCrops } = require('../utils/ai/cropAdvisor');
const { findLgu } = require('../utils/ai/pangasinan');

const M = {
  User: require('../models/User'), Farm: require('../models/Farm'), Field: require('../models/Field'),
  FarmingCycle: require('../models/FarmingCycle'), FinancialRecord: require('../models/FinancialRecord'),
  Budget: require('../models/Budget'), Loan: require('../models/Loan'), LoanPayment: require('../models/LoanPayment'),
  AiInsight: require('../models/AiInsight'), AiChat: require('../models/AiChat'),
};

// ---------------------------------------------------------------- fixtures
const id = () => new mongoose.Types.ObjectId();
const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const U = id(), F = id(), F1 = id(), F2 = id(), C1 = id(), C2 = id(), L1 = id();
const cat = (name, type) => ({ _id: id(), name, type });
const SEEDS = cat('Seeds & Inputs', 'expense'), FERT = cat('Fertilizer', 'expense'), LABOR = cat('Labor', 'expense'),
  IRR = cat('Irrigation', 'expense'), SALES = cat('Crop Sales', 'income');
const rec = (category, amount, days, cycle) => ({ _id: id(), farm: F, category, type: category.type, amount, date: ago(days), farmingCycle: cycle });

const users = {
  farmer: { _id: U, role: 'user', firstName: 'Manuel', lastName: 'Reyes', email: 'manuel@example.com', isActive: true },
  admin: { _id: id(), role: 'admin', firstName: 'Ana', isActive: true },
};
const db = {
  farm: { _id: F, owner: U, name: 'Reyes Family Farm', location: { address: 'Bayambang, Pangasinan' }, totalAreaHectares: 2 },
  fields: [
    { _id: F1, farm: F, name: 'Plot A', areaHectares: 1.5, soilType: 'Clay loam' },
    { _id: F2, farm: F, name: 'Plot B', areaHectares: 0.5, soilType: 'clay loam' },
  ],
  cycles: [
    { _id: C2, field: F2, crop: { name: 'Tomato' }, startDate: ago(150), endDate: ago(40), status: 'harvested', actualYieldKg: 9000 },
    { _id: C1, field: F1, crop: { name: 'Rice' }, startDate: ago(130), endDate: ago(10), status: 'harvested', actualYieldKg: 7200 },
  ],
  records: [
    rec(SEEDS, 5600, 125, C1), rec(FERT, 34500, 100, C1), rec(LABOR, 38500, 60, C1), rec(IRR, 3600, 90, C1), rec(SALES, 140400, 8, C1),
    rec(SEEDS, 6000, 145, C2), rec(FERT, 20000, 120, C2), rec(LABOR, 30000, 80, C2), rec(SALES, 180000, 35, C2),
    rec(IRR, 1500, 15), rec(FERT, 2000, 45),
  ],
  budgets: [{
    _id: id(), farm: F, name: 'Dry season 2026', periodStart: ago(20), periodEnd: ago(-150), totalAmount: 120000,
    categories: [{ category: FERT, allocatedAmount: 30000 }, { category: IRR, allocatedAmount: 1000 }],
  }],
  loans: [{
    _id: L1, farmer: U, cooperative: { name: 'Bayambang Farmers Coop' }, principalAmount: 20000, interestRatePercent: 3.5,
    rateBasis: 'cycle', termMonths: 4, crop: 'rice', growingDays: 120, status: 'active', issuedDate: ago(100), dueDate: ago(-35),
  }],
  payments: [{ _id: L1, paid: 8000 }],
};
let saved; // what the controller wrote (AiInsight / AiChat)

// A stand-in for a Mongoose query: chainable, awaitable, resolves to `value`.
const q = (value) => {
  const chain = { populate: () => chain, sort: () => chain, limit: () => chain, select: () => chain, lean: () => Promise.resolve(value) };
  chain.then = (res, rej) => Promise.resolve(value).then(res, rej);
  return chain;
};

before(() => {
  M.User.findById = (uid) => q(Object.values(users).find((u) => String(u._id) === String(uid)) || null);
  M.Farm.findOne = () => q(db.farm);
  M.Field.find = () => q(db.fields);
  M.FarmingCycle.find = () => q(db.cycles);
  M.FinancialRecord.find = () => q(db.records);
  M.Budget.find = () => q(db.budgets);
  M.Loan.find = () => q(db.loans);
  M.LoanPayment.aggregate = async () => db.payments;
  M.AiInsight.findOne = () => q(saved.insight);
  M.AiInsight.findOneAndUpdate = async (filter, update) => { saved.insight = { ...update }; };
  M.AiChat.findOne = () => q(saved.chat);
  M.AiChat.findOneAndUpdate = async (filter, update) => {
    saved.chat = { messages: [...(saved.chat?.messages || []), ...update.$push.messages.$each] };
  };
  M.AiChat.deleteOne = async () => { saved.chat = null; };
  // Weather is offline in tests
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => (String(url).includes('open-meteo') ? { ok: false } : realFetch(url, opts));
});

let server, base;
before(async () => {
  const app = express();
  app.use(require('compression')()); // same as server.js: must not hold back the chat stream
  app.use(express.json({ limit: '10kb' }));
  app.use('/api/ai', require('../routes/ai.routes'));
  app.use(errorHandler);
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/ai`;
});
after(() => server.close());
beforeEach(() => { saved = { insight: null, chat: null }; setClientForTests(null); });

const auth = (who = 'farmer') => ({ Authorization: `Bearer ${generateAccessToken(users[who])}` });
const get = async (path, who) => (await fetch(base + path, { headers: auth(who) })).json();
const post = (path, body, who) => fetch(base + path, { method: 'POST', headers: { ...auth(who), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

// A fake Gemini that records what it was sent.
function fakeGemini({ json, stream }) {
  const calls = [];
  setClientForTests({
    models: {
      generateContent: async (req) => { calls.push(req); return { text: JSON.stringify(json) }; },
      generateContentStream: async function* (req) { calls.push(req); for (const t of stream) yield { text: t }; },
    },
  });
  return calls;
}

// ---------------------------------------------------------------- tests
test('advisor: welcome message from real numbers, crops for this season in Bayambang', async () => {
  const { data } = await get('/advisor');
  assert.match(data.welcomeMessage, /Magandang araw, Manuel!/);
  assert.match(data.welcomeMessage, /Total Income: ₱140,400/);
  assert.match(data.welcomeMessage, /₱12,700 left to pay/); // 20,000 × 1.035 − 8,000
  assert.equal(data.location.municipality, 'Bayambang');
  assert.ok(data.cropRecommendations.length > 0);
  assert.ok(data.cropRecommendations.every((c) => c.why && c.estimated.profit != null));
  assert.equal(data.suggestedPrompts.length, 6);
});

test('summary without Gemini: rule-based text, engine numbers, budget and crop tags', async () => {
  const { data } = await get('/summary');
  assert.equal(data.source, 'rules');
  assert.deepEqual(data.metrics.map((m) => m.label), ['TOTAL INCOME', 'TOTAL EXPENSES', 'NET BALANCE', 'ACTIVE LOANS']);
  assert.equal(data.metrics[0].value, '₱140,400');
  assert.equal(data.metrics[3].value, '₱12,700');
  const drivers = Object.fromEntries(data.drivers.map((d) => [d.key, d]));
  assert.ok(drivers['budget-management'].tags.some((t) => t.label === 'Irrigation: over by ₱500' && t.tone === 'bad'));
  assert.equal(drivers['crop-profitability'].tags[0].label, 'Tomato: 68.9% margin'); // (180,000 − 56,000) / 180,000
  assert.ok(data.narrative.length && data.focusRecommendation);
  assert.equal(saved.insight, null, 'rule-based answers are not cached');
});

test('summary with Gemini: AI text merged with engine numbers, no farmer name sent, result cached', async () => {
  const calls = fakeGemini({
    json: {
      narrative: [{ text: 'Strong month: ', isHighlight: false }, { text: 'rice paid off', isHighlight: true }],
      drivers: [{ key: 'income-expenses', text: 'AI text about income.' }],
      focusRecommendation: 'AI focus.',
    },
  });
  const { data } = await get('/summary');
  assert.equal(data.source, 'gemini');
  assert.equal(data.narrative[1].text, 'rice paid off');
  assert.equal(data.drivers[0].text, 'AI text about income.');
  assert.ok(data.drivers[1].text.length > 10, 'missing driver text falls back to the rules');
  assert.equal(data.metrics[0].value, '₱140,400');
  assert.match(calls[0].config.systemInstruction, /You are the AI Farm Advisor for FARM FUND/);
  assert.equal(calls[0].config.tools, undefined, 'summary uses only the farmer records, no web search');
  const sent = JSON.stringify(calls);
  assert.ok(!/Manuel|Reyes|manuel@example/.test(sent), 'farmer identity leaked to Gemini');
  assert.ok(saved.insight?.payload, 'Gemini summary was cached');
});

test('chat without Gemini: answers from the rules and saves the conversation', async () => {
  const res = await post('/chat', { message: 'What should I plant this season?' });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /Bayambang/);
  assert.match(text, /Estimated profit/);
  assert.equal(saved.chat.messages.length, 2);
});

test('chat with Gemini: streams, strips markdown, hides phone numbers, sends history', async () => {
  saved.chat = { messages: [{ role: 'user', text: 'hi' }, { role: 'model', text: 'hello' }] };
  const calls = fakeGemini({ stream: ['**Pay** the coop ', 'loan first.'] });
  const res = await post('/chat', { message: 'Text me at 0917 123 4567 about my loan' });
  assert.equal(res.headers.get('content-encoding'), null, 'chat stream must not be gzip-buffered');
  assert.equal(await res.text(), 'Pay the coop loan first.');
  const req = calls[0];
  assert.equal(req.contents.length, 3);
  assert.equal(req.contents.at(-1).parts[0].text, 'Text me at [phone] about my loan');
  assert.match(req.config.systemInstruction, /PLAIN TEXT ONLY/);
  assert.match(req.config.systemInstruction, /You are the AI Farm Advisor for FARM FUND/);
  assert.deepEqual(req.config.tools, [{ googleSearch: {} }], 'chat uses Google Search like the AI Studio setup');
  assert.equal(req.model, 'gemini-3.1-flash-lite');
  assert.equal(req.config.thinkingConfig.thinkingLevel, 'HIGH');
  assert.ok(!/Manuel/.test(req.config.systemInstruction));
});

test('chat history: read and clear', async () => {
  saved.chat = { messages: [{ role: 'user', text: 'q' }, { role: 'model', text: 'a' }] };
  assert.equal((await get('/chat')).data.messages.length, 2);
  const res = await fetch(base + '/chat', { method: 'DELETE', headers: auth() });
  assert.equal(res.status, 200);
  assert.equal(saved.chat, null);
});

test('rejects empty messages, missing login and non-farmer accounts', async () => {
  assert.equal((await post('/chat', { message: '   ' })).status, 400);
  assert.equal((await fetch(base + '/advisor')).status, 401);
  assert.equal((await fetch(base + '/advisor', { headers: auth('admin') })).status, 403);
});

test('crop suggestions follow the Pangasinan calendar', () => {
  const october = new Date('2026-10-18T08:00:00+08:00');
  const recs = recommendCrops({ today: october, lgu: findLgu('Bayambang'), farm: { sizeHa: 2, soilType: 'clay loam' }, pastCrops: ['Rice'], lastCrop: 'Rice', limit: 20 });
  const ids = recs.map((r) => r.id);
  assert.ok(!ids.includes('okra'), 'okra is not planted in Oct–Nov');
  assert.ok(!ids.includes('rice-rainfed'), 'rainfed rice is planted Jun–Jul');
  const rice = recs.find((r) => r.id === 'rice-irrigated');
  assert.ok(rice && !rice.plantNow && rice.reasons.some((r) => r.code === 'NEEDS_IRRIGATION'));
  assert.ok(recs.every((r) => r.suggestedAreaHa <= 2));
});

test('AI Studio settings: Gemini 3.1 Flash-Lite, HIGH thinking only for Gemini 3, env overrides', () => {
  assert.equal(modelChain()[0], 'gemini-3.1-flash-lite');
  assert.deepEqual(thinkingFor('gemini-3.1-flash-lite'), { thinkingConfig: { thinkingLevel: 'HIGH' } });
  assert.deepEqual(thinkingFor('gemini-2.5-flash'), {}, '2.5 models reject thinkingLevel');
  process.env.GEMINI_THINKING_LEVEL = 'low';
  assert.deepEqual(thinkingFor('gemini-3.1-flash-lite'), { thinkingConfig: { thinkingLevel: 'LOW' } });
  delete process.env.GEMINI_THINKING_LEVEL;
});
