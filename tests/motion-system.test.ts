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
assert.match(globalCss, /scrollbar-gutter:\s*stable/)
assert.match(globalCss, /body\[data-scroll-locked\][\s\S]*?margin-right:\s*0\s*!important/)

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

const inputSource = readFileSync(join(sourceRoot, 'components/ui/input.tsx'), 'utf8')
assert.match(inputSource, /transition-\[color,background-color\]/)
assert.doesNotMatch(inputSource, /transition-\[[^\]]*(outline|box-shadow)/)
assert.match(inputSource, /focus:ring-\[3px\]/)
assert.match(inputSource, /focus-visible:outline-ring/)

const selectSource = readFileSync(join(sourceRoot, 'components/ui/select.tsx'), 'utf8')
assert.match(selectSource, /data-\[state=open\]:\[&_svg\[data-select-chevron\]\]:rotate-180/)
assert.match(selectSource, /SelectPrimitive\.Portal/)
assert.match(selectSource, /min-w-\[var\(--radix-select-trigger-width\)\]/)
assert.doesNotMatch(selectSource, /zoom-(in|out)|blur-/)

const sopIndexSource = readFileSync(join(sourceRoot, 'pages/sop/index.tsx'), 'utf8')
const sopReaderSource = readFileSync(join(sourceRoot, 'pages/sop/system-sop-reader.tsx'), 'utf8')
const sopCss = readFileSync(join(sourceRoot, 'pages/sop/sop-guide.css'), 'utf8')
assert.doesNotMatch(sopIndexSource + sopReaderSource, /liquid-gooey|<Liquid/)
assert.match(sopIndexSource, /sop-stage-switcher/)
assert.match(sopIndexSource, /--sop-active-stage/)
assert.match(sopReaderSource, /HoverToolbar/)
assert.match(sopCss, /\.sop-stage-tabs__indicator[\s\S]*?transform:\s*translateX/)
assert.match(sopCss, /@keyframes sop-stage-card-enter[\s\S]*?transform:\s*translateY/)

const dashboardSource = readFileSync(join(sourceRoot, 'pages/dashboard.tsx'), 'utf8')
assert.match(dashboardSource, /hm-dashboard-enter--4/)
assert.match(dashboardSource, /DashboardLoader/)
assert.match(dashboardSource, /RollingMetricValue/)
assert.match(dashboardSource, /CircleSwapLink/)
assert.match(dashboardSource, /UnderlineActionLink/)
assert.match(globalCss, /@keyframes hm-dashboard-enter[\s\S]*?transform:\s*translateY/)
assert.match(globalCss, /@keyframes hm-metric-roll-in[\s\S]*?translateY\(105%\)/)
assert.match(globalCss, /@keyframes hm-dashboard-loader-spin[\s\S]*?rotate\(360deg\)/)
assert.match(globalCss, /\.hm-hover-toolbar:focus-within/)

const packageSource = readFileSync(join(projectRoot, 'package.json'), 'utf8')
assert.doesNotMatch(packageSource, /liquid-gooey/)
