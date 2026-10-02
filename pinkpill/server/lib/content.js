'use strict';
const { invalid } = require('./errors');
/* Server-side content rules for BBCode text. HTML is never produced by the server; the client
   escapes everything before rendering. Here we only block things the client must never load. */
function assertSafeContent(text) {
  if (/\[img\]\s*(?!https:\/\/|\/media\/[0-9a-f-]{36}\s*\[)/i.test(text)) {
    throw invalid('Images must be uploaded or use an https:// link.');
  }
  if (/data:[a-z]+\/[a-z0-9.+-]+;base64/i.test(text)) throw invalid('Embedded data URLs are not allowed. Upload the image instead.');
  if (/\[url=\s*(?!https?:\/\/|mailto:|#\/)/i.test(text)) throw invalid('Links must start with http://, https:// or mailto:.');
  return text;
}
function normalizeTags(list) {
  return [...new Set((list || []).map((s) => String(s).trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')).filter((s) => s.length >= 1 && s.length <= 30))].slice(0, 10);
}
module.exports = { assertSafeContent, normalizeTags };
