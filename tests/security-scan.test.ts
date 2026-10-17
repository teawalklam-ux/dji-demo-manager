import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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
