import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const sourceRoot = join(projectRoot, 'src')

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(path)
    return ['.css', '.ts', '.tsx'].includes(extname(path)) ? [path] : []
  })
}

for (const file of collectSourceFiles(sourceRoot)) {
  const source = readFileSync(file, 'utf8')
  const fileName = relative(projectRoot, file)

  assert.doesNotMatch(
    source,
    /\btransition-all\b|transition\s*:\s*all\b/,
    `${fileName} must declare the properties it transitions`,
  )

  for (const match of source.matchAll(/transition-\[([^\]]+)\]/g)) {
    assert.doesNotMatch(
      match[1],
      /(^|,)(width|height|top|right|bottom|left|margin|padding)(,|$)/,
      `${fileName} must not animate layout property ${match[1]}`,
    )
  }
}

const globalCss = readFileSync(join(sourceRoot, 'index.css'), 'utf8')
assert.match(globalCss, /:focus-visible[\s\S]*?transition-duration:\s*0ms\s*!important/)
assert.match(globalCss, /prefers-reduced-motion:\s*reduce[\s\S]*?transition-duration:\s*0\.01ms\s*!important/)
assert.match(globalCss, /\.hm-sidebar-active-indicator[\s\S]*?transform:\s*translateY/)
assert.match(globalCss, /transform var\(--dur-short\) var\(--ease-out\)/)

const appLayout = readFileSync(join(sourceRoot, 'components/layout/app-layout.tsx'), 'utf8')
assert.match(appLayout, /--hm-sidebar-indicator-offset/)
assert.match(appLayout, /activeIndex \* 2\.75/)

for (const fileName of ['dialog.tsx', 'alert-dialog.tsx', 'sheet.tsx']) {
  const source = readFileSync(join(sourceRoot, 'components/ui', fileName), 'utf8')
  assert.match(source, /duration-short ease-hm-out/)
  assert.match(source, /data-\[state=closed\]:duration-micro data-\[state=closed\]:ease-hm-in/)
}

const tailwindConfig = readFileSync(join(projectRoot, 'tailwind.config.js'), 'utf8')
assert.doesNotMatch(tailwindConfig, /--radix-accordion-content-height/)
assert.match(tailwindConfig, /"accordion-down"[\s\S]*?opacity[\s\S]*?translateY/)

const appSource = readFileSync(join(sourceRoot, 'App.tsx'), 'utf8')
assert.doesNotMatch(appSource, /AnimatePresence|motion\./)
