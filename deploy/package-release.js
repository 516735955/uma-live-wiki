'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const commit = execFileSync('git', ['rev-parse', process.argv[2] || 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const target = path.resolve(process.argv[3] || path.join(os.tmpdir(), 'uma-' + commit + '.tgz'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'uma-package-'));
try {
  const archive = path.join(temporary, 'source.tar');
  const stage = path.join(temporary, 'stage');
  fs.mkdirSync(stage);
  execFileSync('git', ['archive', '--format=tar', '-o', archive, commit], { cwd: root });
  execFileSync('tar', ['-xf', archive, '-C', stage]);
  const ancestors = execFileSync('git', ['rev-list', commit], { cwd: root, encoding: 'utf8' }).trim().split('\n');
  // Use the committed release builder, not an uncommitted local implementation.
  require(path.join(stage, 'deploy/prepare-release')).prepareRelease(stage, commit, ancestors);
  // Do not serialize macOS extended attributes into Linux release packages.
  execFileSync('tar', ['-czf', target, '-C', stage, '.'], { env: { ...process.env, COPYFILE_DISABLE: '1' } });
  console.log(target);
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
