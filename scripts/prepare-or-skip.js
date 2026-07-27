'use strict';

const path = require('path');

/**
 * When pc-open (or another app) installs this package via file:/link,
 * npm runs `prepare` in this repo. Skip rebuild in that case — use the
 * already-built lib-es5. Run `npm run build` manually in pkg when needed.
 */
const pkgRoot = path.resolve(__dirname, '..');
const initCwd = process.env.INIT_CWD && path.resolve(process.env.INIT_CWD);

if (initCwd && initCwd !== pkgRoot) {
  // eslint-disable-next-line no-console
  console.warn(
    `[@sunjingyun/pkg] skip prepare (installed from ${initCwd})`,
  );
  process.exit(0);
}

try {
  require.resolve('@sunjingyun/pkg-fetch');
} catch {
  // eslint-disable-next-line no-console
  console.warn(
    '[@sunjingyun/pkg] skip prepare: @sunjingyun/pkg-fetch not linked',
  );
  process.exit(0);
}

const { spawnSync } = require('child_process');
const result = spawnSync('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status === null ? 1 : result.status);
