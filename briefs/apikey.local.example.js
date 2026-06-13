// Built-in Anthropic API key for this personal build.
//
// 1. Copy this file to `apikey.local.js` (same folder).
// 2. Replace the placeholder with your real key.
//
// apikey.local.js is gitignored (never committed) but IS bundled into the built
// app, so the packaged Briefs.app works with no setup. Because the key ships
// inside the app bundle and is extractable, do NOT distribute that build to others.
//
// You can also skip this file and set ANTHROPIC_API_KEY in the environment instead.

module.exports = 'sk-ant-REPLACE-WITH-YOUR-KEY'
