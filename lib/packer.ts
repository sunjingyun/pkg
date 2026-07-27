import assert from 'assert';
import { readFileSync } from 'fs';
import path from 'path';

import {
  STORE_BLOB,
  STORE_CONTENT,
  STORE_LINKS,
  STORE_STAT,
  isDotJS,
  isDotJSON,
} from './common';

import { log, wasReported } from './log';
import { FileRecord, FileRecords, SymLinks } from './types';

const { version } = JSON.parse(
  readFileSync(path.join(__dirname, '../package.json'), 'utf-8'),
);

const bootstrapText = readFileSync(
  require.resolve('../prelude/bootstrap.js'),
  'utf8',
).replace('%VERSION%', version);

const commonText = readFileSync(require.resolve('./common'), 'utf8');

const sharedText = readFileSync(
  require.resolve('../prelude/bootstrap-shared.js'),
  'utf8',
);

// When --debug is used, inject a small snippet that calls the shared
// diagnostic + dumps the DICT path compression map (traditional-mode only).
const diagnosticText = `
(function() {
  if (process.env.DEBUG_PKG === '2') {
    console.log('------------------------------- path dictionary');
    console.log(Object.entries(DICT));
  }
  var snapshotPrefix = process.platform === 'win32' ? 'C:\\\\snapshot' : '/snapshot';
  REQUIRE_SHARED.installDiagnostic(snapshotPrefix);
})();
`;

function itemsToText<T>(items: T[]) {
  const len = items.length;
  return len.toString() + (len % 10 === 1 ? ' item' : ' items');
}

function hasAnyStore(record: FileRecord) {
  // discarded records like native addons
  for (const store of [STORE_BLOB, STORE_CONTENT, STORE_LINKS, STORE_STAT]) {
    if (record[store]) return true;
  }
  return false;
}

interface PackerOptions {
  records: FileRecords;
  entrypoint: string;
  bytecode: boolean;
  symLinks: SymLinks;
}

export interface Stripe {
  snap: string;
  skip?: boolean;
  store: number;
  file?: string;
  buffer?: Buffer;
}

export default function packer({
  records,
  entrypoint,
  bytecode,
}: PackerOptions) {
  const stripes: Stripe[] = [];

  // If the entrypoint was a .mjs file that got transformed, update its extension
  if (records[entrypoint]?.wasTransformed && entrypoint.endsWith('.mjs')) {
    entrypoint = `${entrypoint.slice(0, -4)}.js`;
  }

  for (let snap in records) {
    if (records[snap]) {
      const record = records[snap];
      const { file } = record;

      if (!hasAnyStore(record)) {
        continue;
      }

      // If .mjs file was transformed to CJS, also publish it as .js so the
      // CJS loader does not treat the body as ESM. Keep the original .mjs
      // snapshot path too — package.json "exports" (e.g. module-sync) still
      // point at *.mjs, and dropping that path causes MODULE_NOT_FOUND.
      const snapPaths =
        record.wasTransformed && snap.endsWith('.mjs')
          ? [snap, `${snap.slice(0, -4)}.js`]
          : [snap];

      assert(record[STORE_STAT], 'packer: no STORE_STAT');
      assert(
        record[STORE_BLOB] ||
          record[STORE_CONTENT] ||
          record[STORE_LINKS] ||
          record[STORE_STAT],
      );

      if (record[STORE_BLOB] && !bytecode) {
        delete record[STORE_BLOB];
        if (!record[STORE_CONTENT]) {
          // TODO make a test for it?
          throw wasReported(
            '--no-bytecode and no source breaks final executable',
            [
              file,
              'Please run with "-d" and without "--no-bytecode" first, and make',
              'sure that debug log does not contain "was included as bytecode".',
            ],
          );
        }
      }
      for (const snapPath of snapPaths) {
        for (const store of [
          STORE_BLOB,
          STORE_CONTENT,
          STORE_LINKS,
          STORE_STAT,
        ]) {
          const value = record[store];

          if (!value) {
            continue;
          }

          if (store === STORE_BLOB || store === STORE_CONTENT) {
            if (record.body === undefined) {
              stripes.push({ snap: snapPath, store, file });
            } else if (Buffer.isBuffer(record.body)) {
              stripes.push({ snap: snapPath, store, buffer: record.body });
            } else if (typeof record.body === 'string') {
              stripes.push({
                snap: snapPath,
                store,
                buffer: Buffer.from(record.body),
              });
            } else {
              assert(false, 'packer: bad STORE_BLOB/STORE_CONTENT');
            }
          } else if (store === STORE_LINKS) {
            if (Array.isArray(value)) {
              const dedupedValue = [...new Set(value)];
              log.debug('files & folders deduped = ', dedupedValue);
              const buffer = Buffer.from(JSON.stringify(dedupedValue));
              stripes.push({ snap: snapPath, store, buffer });
            } else {
              assert(false, 'packer: bad STORE_LINKS');
            }
          } else if (store === STORE_STAT) {
            if (typeof value === 'object') {
              const newStat = { ...value };
              const buffer = Buffer.from(JSON.stringify(newStat));
              stripes.push({ snap: snapPath, store, buffer });
            } else {
              assert(false, 'packer: unknown store');
            }
          }
        }
      }

      if (record[STORE_CONTENT]) {
        const disclosed = isDotJS(file) || isDotJSON(file);
        log.debug(
          disclosed
            ? 'The file was included as DISCLOSED code (with sources)'
            : 'The file was included as asset content',
          file,
        );
      } else if (record[STORE_BLOB]) {
        log.debug('The file was included as bytecode (no sources)', file);
      } else if (record[STORE_LINKS]) {
        const link = record[STORE_LINKS];
        log.debug(
          `The directory files list was included (${itemsToText(link)})`,
          file,
        );
      }
    }
  }
  const prelude =
    `return (function (REQUIRE_COMMON, REQUIRE_SHARED, VIRTUAL_FILESYSTEM, DEFAULT_ENTRYPOINT, SYMLINKS, DICT, DOCOMPRESS) {
        ${bootstrapText}${
          log.debugMode ? diagnosticText : ''
        }\n})(function (exports) {\n${commonText}\n},\n` +
    `(function () { var module = { exports: {} };\n${sharedText}\nreturn module.exports; })(),\n` +
    `%VIRTUAL_FILESYSTEM%` +
    `\n,\n` +
    `%DEFAULT_ENTRYPOINT%` +
    `\n,\n` +
    `%SYMLINKS%` +
    '\n,\n' +
    '%DICT%' +
    '\n,\n' +
    '%DOCOMPRESS%' +
    `\n);`;

  return { prelude, entrypoint, stripes };
}
