import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { scanText, scanPath, scanRepository } from '../scripts/security-scan.mjs'

test('secret and personal-data findings never include the matched values', () => {
  const token = ['ghp', 'a'.repeat(36)].join('_')
  const email = ['private-person', 'company.example.cn'].join('@')
  const phone = ['138', '0123', '4567'].join('')
  const source = [token, email, phone].join('\n')
  const findings = scanText('source.ts', source)
  assert.deepEqual(findings.map(f => f.rule), ['access-token', 'personal-email', 'personal-phone'])
  for (const value of [token, email, phone]) assert.ok(!JSON.stringify(findings).includes(value))
})

test('only specific examples are exempt; test files do not get a blanket bypass', () => {
  assert.deepEqual(scanText('fixture.ts', 'user@example.test\nhttps://your-project.supabase.co'), [])
  assert.deepEqual(scanText('src/lib/demo-mode.ts', ['DEMO_PASSWORD', " = 'demo123456'"].join('')), [])
  const realLooking = ['PASSWORD', " = 'unapproved-value'"].join('')
  assert.ok(scanText('tests/fixture.ts', realLooking).some(f => f.rule === 'literal-credential'))
  assert.equal(scanPath('.env.production').length, 1)
  assert.equal(scanPath('artifacts/capture.json').length, 1)
  assert.equal(scanPath('nested/.env.example').length, 0)
  assert.ok(scanText('.env.example', ['PASSWORD', '=not-a-placeholder'].join('')).some(f => f.rule === 'non-placeholder-env-value'))
  assert.deepEqual(scanText('.env.example', ['PASSWORD', '=replace-with-your-password'].join('')), [])
})

test('history catches a secret deleted from the current tree; index catches staged-only secrets', () => {
  const repo = mkdtempSync(join(tmpdir(), 'repository-security-test-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  try {
    git('init', '-q')
    git('config', 'user.name', 'Security Test')
    git('config', 'user.email', 'test@example.test')
    git('config', 'commit.gpgsign', 'false')
    const token = ['ghp', 'b'.repeat(36)].join('_')
    writeFileSync(join(repo, 'config.txt'), token)
    git('add', 'config.txt')
    writeFileSync(join(repo, 'config.txt'), 'clean')
    assert.equal(scanRepository({ repo }).findings.length, 0)
    assert.ok(scanRepository({ repo, staged: true }).findings.some(f => f.rule === 'access-token'))
    git('commit', '-qm', 'fixture')
    git('add', 'config.txt')
    git('commit', '-qm', 'remove fixture')
    assert.equal(scanRepository({ repo }).findings.length, 0)
    assert.ok(scanRepository({ repo, history: true }).findings.some(f => f.rule === 'access-token'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('history detects private commit identity even when files are clean', () => {
  const repo = mkdtempSync(join(tmpdir(), 'repository-identity-test-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  try {
    git('init', '-q')
    git('config', 'user.name', 'Test Contributor')
    git('config', 'user.email', ['private-person', 'company.example.cn'].join('@'))
    git('config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'README.md'), 'Clean content')
    git('add', '.')
    git('commit', '-qm', 'Clean content')
    assert.equal(scanRepository({ repo }).findings.length, 0)
    assert.ok(scanRepository({ repo, history: true }).findings.some(f => f.file === '[commit]' && f.rule === 'personal-email'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('public image approval is bound to exact content', () => {
  const repo = mkdtempSync(join(tmpdir(), 'repository-image-test-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' })
  try {
    git('init', '-q')
    mkdirSync(join(repo, 'public'))
    mkdirSync(join(repo, 'docs'))
    const data = Buffer.from([0, 1, 2, 3])
    writeFileSync(join(repo, 'public', 'guide.png'), data)
    assert.ok(scanRepository({ repo }).findings.some(f => f.rule === 'unreviewed-public-image'))
    writeFileSync(join(repo, 'docs', 'reviewed-public-images.json'), JSON.stringify({ 'public/guide.png': createHash('sha256').update(data).digest('hex') }))
    assert.equal(scanRepository({ repo }).findings.length, 0)
    writeFileSync(join(repo, 'public', 'guide.png'), Buffer.from([0, 4, 5, 6]))
    assert.ok(scanRepository({ repo }).findings.some(f => f.rule === 'unreviewed-public-image'))
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})
