import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Findings contain locations and rule names only, never matched values.
const rules = [
  ['private-key', /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/g],
  ['access-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sbp_[a-f0-9]{30,}|sb_secret_[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g],
  ['webhook-key', /https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[A-Za-z0-9-]{16,}/g],
  ['url-password', /\b(?:postgres(?:ql)?|mysql|https?):\/\/[^\s/:]+:[^\s/@]+@/g],
  ['project-endpoint', /\b[a-z0-9]{20}\.supabase\.co\b/g],
  ['publishable-key-in-source', /\bsb_publishable_[A-Za-z0-9_-]{15,}\b/g],
  ['personal-email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g],
  ['personal-phone', /(?<![\w.])(?:\+?86[- ]?)?1[3-9]\d{9}(?![\w.])/g],
  ['private-network-address', /\b(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})\b/g],
  ['personal-home-path', /(?:[A-Z]:[\\/](?:Users|KGames|CodexHome)[\\/][^\s'"<>]+|\/(?:Users|home)\/(?!runner\b)[^\s/'"<>]+)/g],
  ['literal-credential', /\b(?:[A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|APIKEY|ANON_KEY|SERVICE_ROLE_KEY))\s*[:=]\s*['"][^'"\r\n]{6,}['"]/gi],
]

const demoFiles = new Set(['scripts/demo-server.mjs', 'src/lib/demo-mode.ts'])

function isExample(rule, value, file) {
  if (rule === 'personal-email') {
    const domain = value.split('@')[1].toLowerCase()
    return /(?:^|\.)(?:example\.(?:com|org|net)|test|invalid)$/.test(domain)
      || domain === 'users.noreply.github.com' || domain === 'noreply.github.com'
      || (file === 'supabase/config.toml' && domain === 'email.com' && /^(?:user|admin)@/.test(value))
  }
  if (rule === 'literal-credential') {
    const literal = value.match(/['"]([^'"]+)['"]$/)?.[1] || ''
    // These are non-operational examples. Real-looking credentials in tests still fail.
    if (/^(?:env\(|replace[-_]|your[-_]|<)/i.test(literal)) return true
    if (demoFiles.has(file) && literal === 'demo123456' && value.startsWith('DEMO_PASSWORD')) return true
    if (file === 'scripts/sop-capture-fixtures.mjs' && literal === 'isolated-documentation-fixture') return true
    if (file === 'nas/return-photo-archive/test_archive_agent.py'
      && (['token', 'user-token', 'public-key', 'archive-test-token'].includes(literal)
        || /^0{8}-0{4}-4000-8000-0{11}\d$/.test(literal))) return true
  }
  return false
}

export function scanPath(file) {
  const basename = file.split('/').at(-1)
  const privatePath = /(?:^|\/)(?:\.codex|\.agents|\.codebuddy|\.workbuddy|\.hallmark|artifacts|outputs|node_modules|dist|coverage|playwright-report|test-results|certs)\//.test(file)
    || (basename.startsWith('.env') && basename !== '.env.example')
    || /\.(?:pem|key|p12|pfx|sqlite3?|db(?:-wal|-shm)?|dump|backup|log|tsbuildinfo)$/i.test(file)
  return privatePath ? [{ file, line: 1, rule: 'private-file' }] : []
}

export function scanText(file, source) {
  const findings = []
  for (const [index, line] of source.split('\n').entries()) {
    for (const [rule, pattern] of rules) {
      pattern.lastIndex = 0
      if ([...line.matchAll(pattern)].some(match => !isExample(rule, match[0], file))) {
        findings.push({ file, line: index + 1, rule })
      }
    }
    if (file.endsWith('/00019_set_super_admin.sql')
      && /\b[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\b/i.test(line)) {
      findings.push({ file, line: index + 1, rule: 'production-admin-id' })
    }
    if (file.split('/').at(-1) === '.env.example') {
      const assignment = line.match(/^\s*([A-Z_]*(?:PASSWORD|SECRET|TOKEN|KEY|WEBHOOK_URL))\s*=\s*(.*?)\s*$/)
      if (assignment) {
        const value = assignment[2].replace(/^['"]|['"]$/g, '')
        if (value && !/^(?:replace[-_]|your[-_]|<)/i.test(value)) {
          findings.push({ file, line: index + 1, rule: 'non-placeholder-env-value' })
        }
      }
    }
  }
  return findings
}

function git(repo, args, input) {
  return execFileSync('git', ['-C', repo, ...args], {
    input, maxBuffer: 512 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'],
  })
}

export function scanRepository({ repo = '.', history = false, staged = false } = {}) {
  let scanned = 0
  let binaries = 0
  const findings = []
  const inspect = (file, data, oid) => {
    scanned++
    const entries = scanPath(file)
    if (data.includes(0) || /\.(?:jpe?g|png|webp|gif|ico|woff2?|pdf|zip|xlsx?)$/i.test(file)) binaries++
    else entries.push(...scanText(file, data.toString('utf8')))
    findings.push(...entries.map(entry => oid ? { ...entry, object: oid } : entry))
  }
  if (history) {
    const entries = git(repo, ['rev-list', '--objects', '--all']).toString().trim().split('\n').filter(Boolean)
    const paths = new Map(entries.map(line => {
      const space = line.indexOf(' ')
      return space < 0 ? [line, ''] : [line.slice(0, space), line.slice(space + 1)]
    }))
    const objects = git(repo, ['cat-file', '--batch'], [...paths.keys()].join('\n') + '\n')
    let offset = 0
    while (offset < objects.length) {
      const end = objects.indexOf(10, offset)
      const [oid, type, sizeText] = objects.subarray(offset, end).toString().split(' ')
      const size = Number(sizeText)
      if (end < 0 || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid Git object framing')
      offset = end + 1
      const data = objects.subarray(offset, offset + size)
      offset += size + 1
      if (type === 'blob') inspect(paths.get(oid), data, oid)
      if (type === 'commit' || type === 'tag') inspect(`[${type}]`, data, oid)
    }
  } else {
    const args = staged ? ['ls-files', '-z'] : ['ls-files', '--cached', '--others', '--exclude-standard', '-z']
    const files = new Set(git(repo, args).toString().split('\0').filter(Boolean))
    for (const file of files) {
      try {
        const data = staged ? git(repo, ['show', `:${file}`]) : readFileSync(resolve(repo, file))
        inspect(file, data)
      } catch (error) {
        if (!staged && error.code === 'ENOENT') continue
        throw error
      }
    }
  }
  return { mode: history ? 'history' : staged ? 'index' : 'working-tree', scanned, binaries, findings }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2)
    const repoIndex = args.indexOf('--repo')
    const result = scanRepository({ repo: repoIndex < 0 ? '.' : args[repoIndex + 1], history: args.includes('--history'), staged: args.includes('--staged') })
    if (args.includes('--json')) console.log(JSON.stringify(result, null, 2))
    else {
      for (const finding of result.findings) console.error(`${finding.file}:${finding.line}: ${finding.rule}${finding.object ? ` (${finding.object.slice(0, 12)})` : ''}`)
      console.log(`Security scan (${result.mode}): ${result.scanned} objects/files, ${result.findings.length} findings. ${result.binaries} binary objects require separate review.`)
    }
    process.exitCode = result.findings.length ? 1 : 0
  } catch {
    console.error('Security scan could not complete. Check repository access; no file contents are printed.')
    process.exitCode = 2
  }
}
