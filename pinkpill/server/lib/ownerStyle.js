'use strict';
/* Special username colours and effects: the owner's, and anyone the owner grants them to.
   Ids only; the look lives in CSS. Keep in sync with migration 014 and public/js/ui.js. */
const COLORS = ['rainbow', 'galaxy', 'inferno', 'frost', 'royal', 'toxic', 'sakura', 'midnight',
  'ocean', 'sunset', 'emerald', 'crimson', 'lavender', 'candy', 'aurora', 'chrome', 'peach', 'cyber',
  'lava', 'mint', 'blush', 'storm', 'gold', 'nebula'];
const EFFECTS = ['flow', 'pulse', 'sparkle', 'neon', 'glitch', 'float', 'flicker', 'prism', 'shadow',
  'outline', 'hearts', 'crown', 'stars', 'fire', 'wave', 'glow'];
module.exports = { COLORS, EFFECTS };
