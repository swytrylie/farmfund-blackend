// One-time cleanup for text that was saved in HTML-escaped form.
//
// Before the validators were fixed, the server escaped text BEFORE saving it:
// "Smith & Sons" was stored as "Smith &amp; Sons", "O'Brien" as "O&#x27;Brien",
// "50/50" as "50&#x2F;50". Fixing the validators stops new records being
// damaged, but records already saved stay that way. This restores them.
//
// Safe by default: it only PRINTS what it would change. Nothing is written
// unless you add --apply.
//
//   node scripts/unescapeStoredText.js                        (preview only)
//   node scripts/unescapeStoredText.js --apply                (actually saves)
//   node scripts/unescapeStoredText.js --before=2026-10-08    (only records last
//                                                              updated before that date)
//
// Run it ONCE, right after the fixed validators are live. After that, new
// records are stored exactly as typed — so if someone has since typed a
// literal "&amp;" into a field, running this later would wrongly "fix" it.
// --before=<the day you deployed the fix> protects against that.
//
// Only the text fields listed below are touched, a field is only changed if
// it still holds the exact value that was read (so a record edited while this
// runs is left alone), and records' "updatedAt" times are not changed.

const ENTITY_SOURCE = '&(?:amp|quot|#x27|lt|gt|#x2F|#x5C|#96);';
const ENTITY_MAP = {
  '&amp;': '&',
  '&quot;': '"',
  '&#x27;': "'",
  '&lt;': '<',
  '&gt;': '>',
  '&#x2F;': '/',
  '&#x5C;': '\\',
  '&#96;': '`',
};

// A SINGLE pass, so it undoes exactly one round of escaping: something the
// person really typed as "&amp;" was stored as "&amp;amp;" and comes back as
// "&amp;", not as "&".
function decodeEntities(value) {
  if (typeof value !== 'string') return value;
  return value.replace(new RegExp(ENTITY_SOURCE, 'g'), (match) => ENTITY_MAP[match]);
}

// Every text field that used to be escaped before saving. (Collection names are
// the ones Mongoose creates from the model names.)
const TARGETS = [
  { collection: 'users', fields: ['firstName', 'lastName', 'phone'] },
  { collection: 'cooperatives', fields: ['name', 'registrationNumber', 'address', 'contactPhone'] },
  { collection: 'budgets', fields: ['name'] },
  { collection: 'financialrecords', fields: ['description', 'receiptMetadata.notes'] },
  { collection: 'farmingcycles', fields: ['customCropName', 'notes'] },
  { collection: 'farms', fields: ['name', 'location.address'] },
  { collection: 'fields', fields: ['name', 'soilType'] },
];

const getPath = (obj, path) => path.split('.').reduce((o, key) => (o == null ? undefined : o[key]), obj);

// Works out what would change, without changing anything.
function planChanges(docs, fields) {
  const changes = [];
  for (const doc of docs) {
    const set = {};
    const before = {};
    for (const field of fields) {
      const value = getPath(doc, field);
      if (typeof value !== 'string') continue;
      const decoded = decodeEntities(value);
      if (decoded !== value) {
        set[field] = decoded;
        before[field] = value;
      }
    }
    if (Object.keys(set).length > 0) changes.push({ id: doc._id, set, before });
  }
  return changes;
}

async function runCleanup(db, { apply = false, before = null, verbose = false, log = console.log } = {}) {
  const existing = new Set((await db.listCollections().toArray()).map((c) => c.name));
  const summary = { documents: 0, fields: 0, perCollection: {} };

  for (const { collection, fields } of TARGETS) {
    if (!existing.has(collection)) {
      log(`  ${collection}: no such collection — skipped`);
      continue;
    }

    const hasEntities = { $or: fields.map((field) => ({ [field]: { $regex: ENTITY_SOURCE } })) };
    const filter = before
      ? { $and: [hasEntities, { $or: [{ updatedAt: { $lt: before } }, { updatedAt: { $exists: false } }] }] }
      : hasEntities;
    const projection = Object.fromEntries(fields.map((field) => [field, 1]));

    const col = db.collection(collection);
    const docs = await col.find(filter, { projection }).toArray();
    const changes = planChanges(docs, fields);
    const fieldCount = changes.reduce((n, c) => n + Object.keys(c.set).length, 0);

    summary.documents += changes.length;
    summary.fields += fieldCount;
    summary.perCollection[collection] = changes.length;

    log(`  ${collection}: ${changes.length} record(s), ${fieldCount} field(s) to fix`);
    const shown = verbose ? changes : changes.slice(0, 20);
    for (const change of shown) {
      for (const field of Object.keys(change.set)) {
        log(`      ${change.id}  ${field}:  ${JSON.stringify(change.before[field])}  ->  ${JSON.stringify(change.set[field])}`);
      }
    }
    if (changes.length > shown.length) log(`      …and ${changes.length - shown.length} more (use --verbose to list them all)`);

    if (apply && changes.length > 0) {
      await col.bulkWrite(
        changes.map((change) => ({
          // The `before` values in the filter mean a field is only changed if
          // it still holds exactly what was read.
          updateOne: { filter: { _id: change.id, ...change.before }, update: { $set: change.set } },
        }))
      );
    }
  }
  return summary;
}

async function main() {
  require('dotenv').config();
  const mongoose = require('mongoose');
  // Connects through the server's own module, which carries the DNS
  // workaround for the Windows/Node 22 "querySrv ECONNREFUSED" bug.
  const connectDB = require('../config/db');

  const apply = process.argv.includes('--apply');
  const verbose = process.argv.includes('--verbose');
  const beforeArg = process.argv.find((a) => a.startsWith('--before='));
  let before = null;
  if (beforeArg) {
    before = new Date(beforeArg.split('=')[1]);
    if (Number.isNaN(before.getTime())) {
      console.error('--before must be a date, like --before=2026-10-08');
      process.exitCode = 1;
      return;
    }
  }

  await connectDB();
  console.log(apply ? '\nAPPLYING changes:\n' : '\nPREVIEW ONLY — nothing will be saved:\n');
  const summary = await runCleanup(mongoose.connection.db, { apply, before, verbose });
  console.log(
    `\n${summary.documents} record(s), ${summary.fields} field(s) ${apply ? 'fixed.' : 'would be fixed. Run again with --apply to save them.'}`
  );
}

module.exports = { decodeEntities, planChanges, runCleanup, TARGETS, ENTITY_SOURCE };

if (require.main === module) {
  main()
    .catch((err) => {
      console.error('Failed:', err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      try {
        await require('mongoose').disconnect();
      } catch {
        /* nothing to disconnect */
      }
    });
}