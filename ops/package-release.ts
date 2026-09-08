/** Bun1.2.21 artifact tooling; the application itself stays on Node20.20.2. */
import { chmodSync, lstatSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'

const args = Object.fromEntries(process.argv.slice(2).reduce<string[][]>((pairs, item, i, all) => {
  if (i % 2 === 0) pairs.push([item, all[i + 1]])
  return pairs
}, []))
const app = args['--app']; const sha = args['--sha']; const run = args['--run']
if (!/^[a-z][a-z0-9-]{1,40}$/.test(app ?? '') || !/^[a-f0-9]{40}$/.test(sha ?? '') || !/^\d+$/.test(run ?? '')) throw Error('Invalid release identity')
if (process.platform !== 'linux' || process.arch !== 'x64' || Bun.version !== '1.2.21') throw Error('Linux x64 Bun1.2.21 packaging required')
if (execFileSync('node', ['--version'], { encoding: 'utf8' }).trim() !== 'v20.20.2') throw Error('Node20.20.2 runtime required')
const source = process.cwd(); const temp = mkdtempSync(join(tmpdir(), 'bot-artifact-')); const stage = join(temp, 'stage')
const helper = join(source, 'ops/vendor/release.py')
function python(args: string[]) { execFileSync('python3', [helper, ...args], { stdio: 'inherit' }) }
try {
  // Include all locked dependencies: the existing bots import some devDependencies at runtime.
  python(['stage', '--source', source, '--output', stage,
    '--include', 'dist', '--include', 'locales', '--include', 'package.json', '--include', 'node_modules'])
  writeFileSync(join(stage, 'RELEASE_SHA'), sha + '\n')
  writeFileSync(join(stage, 'runtime.json'), JSON.stringify({ schemaVersion: 1, name: 'node', version: '20.20.2', platform: 'linux', arch: 'x64', artifactTool: { name: 'bun', version: Bun.version } }) + '\n')
  function normalize(dir: string) {
    chmodSync(dir, 0o755)
    for (const entry of readdirSync(dir)) {
      const file = join(dir, entry); const info = lstatSync(file)
      if (info.isSymbolicLink()) {
        const link = readlinkSync(file)
        if (isAbsolute(link)) {
          // A checked-in workspace link can only refer back inside this staging tree.
          const rel = relative(source, link)
          if (rel.startsWith('..') || isAbsolute(rel)) throw Error('External runtime symlink')
          const dest = resolve(stage, rel)
          rmSync(file); symlinkSync(relative(dir, dest), file)
        }
      } else if (info.isDirectory()) normalize(file)
      else if (info.isFile()) chmodSync(file, info.mode & 0o111 ? 0o755 : 0o644)
      else throw Error('Unsupported runtime file')
    }
  }
  normalize(stage)
  python(['pack', '--source', stage, '--output', join(source, 'artifact/release.tar.gz'),
    '--app', app, '--git-sha', sha, '--run-id', run, '--platform', 'linux', '--arch', 'x64', '--bun-version', Bun.version])
} finally { rmSync(temp, { recursive: true, force: true }) }
