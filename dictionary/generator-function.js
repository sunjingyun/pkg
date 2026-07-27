'use strict';

// Node 20.19+/22+/24 resolve `require('generator-function')` via
// exports `module-sync` → require.mjs, which ESM-imports ./index.js.
// pkg's snapshot ESM loader cannot follow that edge, so force the CJS
// `legacy.js` entry (same idea as chalk-style dictionary patches — not an
// app-level build script).
module.exports = {
  pkg: {
    scripts: ['legacy.js'],
    patches: {
      'package.json': [
        { do: 'erase' },
        [
          '{',
          '\t"name": "generator-function",',
          '\t"main": "./legacy.js",',
          '\t"exports": {',
          '\t\t".": "./legacy.js",',
          '\t\t"./package.json": "./package.json"',
          '\t}',
          '}',
          '',
        ].join('\n'),
      ],
    },
  },
};
