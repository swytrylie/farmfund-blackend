# AI Farm Advisor

The AI Advisor page, the AI Summary page and the floating chat widget get their
answers from these endpoints. Every route needs a signed-in farmer account
(`protect`); admins get 403.

| Endpoint | What it returns |
|---|---|
| `GET /api/ai/advisor` (`?refresh=1` to skip the cache) | Gemini writes the welcome message and picks and explains the crops to plant now (from FARM FUND's in-season candidates for the farm's municipality). Cached per farmer. |
| `GET /api/ai/summary` (`?refresh=1` to skip the cache) | The AI Financial Summary: metrics, four "what's driving this" cards and a focus recommendation. |
| `POST /api/ai/chat` `{ message }` | The advisor's answer, streamed as plain text while it is written. |
| `GET /api/ai/chat` and `DELETE /api/ai/chat` | Load or clear the saved conversation. |

## Setup

Add these in Vercel → Project → Settings → Environment Variables (and `.env` locally):

```
GEMINI_API_KEY=...                       # free key: https://aistudio.google.com/apikey
GEMINI_MODEL=gemini-3.1-flash-lite        # optional; the model from AI Studio
GEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite   # optional; tried when the first model is out of quota
GEMINI_THINKING_LEVEL=HIGH               # optional; LOW answers faster
AI_CHAT_WEB_SEARCH=true                  # optional; false = the chat doesn't search Google
AI_ADVISOR_WEB_SEARCH=true               # optional; false = the advisor opening doesn't search Google
AI_CACHE_HOURS=6                         # optional; how long a summary is reused
AI_DEBUG=false                           # optional; logs when the AI falls back to the rules
```

Without `GEMINI_API_KEY` everything still works. The answers are then written
from the farmer's numbers by rules (`utils/ai/advisorText.js`) instead of by the AI.

## How it works

- `utils/ai/farmFacts.js` reads the farmer's Farm, Fields, Farming Cycles,
  Financial Records, Budget and Loans and computes every number: last 30 days vs
  the 30 before, 12-month totals, profit per crop cycle, costs above typical,
  budget categories over their allocation, and loan balances (the same math as
  the Loans page).
- `utils/ai/cropAdvisor.js`, `cropCalendar.js` and `pangasinan.js` pick the crops
  that fit this month in the farm's municipality (all 44 municipalities and 4 cities),
  using the Pangasinan wet/dry season calendar, field soil type, past crops and the
  16-day weather forecast from Open-Meteo (`weather.js`, free, no key).
- `utils/ai/gemini.js` sends those facts to Gemini (`prompts.js` forbids it from
  inventing numbers). The farmer's name, email, phone and address are never sent.
  Phone numbers and emails typed into the chat are hidden before sending.
- Results: AI summaries are cached in `AiInsight` (auto-deleted by a TTL index);
  conversations are kept in `AiChat` (last 100 messages per farmer).
- Each farmer can make 8 AI requests per minute, to stay inside the free Gemini quota.

## Before a real deployment

The crop yields, prices and costs in `utils/ai/cropCalendar.js` are placeholder
estimates. Replace them with DA Region I / PSA figures, and have the Municipal
Agriculture Office check the planting months.

## Tests

`npm test` runs `tests/ai.test.js` (no database or API key needed: models and Gemini are faked).
