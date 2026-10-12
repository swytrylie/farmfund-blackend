// Run by Vercel while building (the "vercel-build" script). Writes the moment
// of the build next to the code, so the admin page can show "Last deployed".
// It must never stop a deployment: any problem is ignored.
const fs = require('fs');
const path = require('path');

try {
  const file = path.join(__dirname, '..', 'buildInfo.json');
  fs.writeFileSync(file, JSON.stringify({ builtAt: new Date().toISOString() }, null, 2) + '\n');
} catch (err) {
  console.warn('Could not write buildInfo.json:', err.message);
}