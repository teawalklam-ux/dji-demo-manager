import { useEffect, useState } from 'react'
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'

const STATUS_CHART_COLORS = {
  in_stock: 'var(--color-chart-in-stock)',
  reserved: 'var(--color-chart-reserved)',
  borrowed: 'var(--color-chart-borrowed)',
  overdue: 'var(--color-chart-overdue)',
  maintenance: 'var(--color-chart-maintenance)',
  retired: 'var(--color-chart-retired)',
} as const

export interface StatusDistributionDatum {
  status: keyof typeof STATUS_CHART_COLORS
  name: string
  value: number
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches)

    updatePreference()
    mediaQuery.addEventListener('change', updatePreference)

    return () => mediaQuery.removeEventListener('change', updatePreference)
  }, [])

  return prefersReducedMotion
}

export function StatusDistributionChart({
  data,
  total,
}: {
  data: StatusDistributionDatum[]
  total: number
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const prefersReducedMotion = usePrefersReducedMotion()
  const activeDatum = activeIndex === null ? null : data[activeIndex]

  return (
    <div
      className="hm-chart-motion relative h-[17.5rem] min-w-0"
      role="group"
      aria-label={`样机状态分布：全部 ${total} 台`}
      onMouseLeave={() => setActiveIndex(null)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={68}
            outerRadius={96}
            paddingAngle={6}
            cornerRadius={8}
            dataKey="value"
            stroke="var(--color-paper)"
            strokeWidth={2}
            strokeLinecap="round"
            isAnimationActive={!prefersReducedMotion}
            animationBegin={0}
            animationDuration={900}
            animationEasing="ease-out"
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.status}
                className={`hm-donut-segment${activeIndex === index ? ' is-active' : ''}`}
                fill={STATUS_CHART_COLORS[entry.status]}
                aria-label={`${entry.name}：${entry.value} 台`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => setActiveIndex((current) => (current === index ? null : index))}
              />
            ))}
          </Pie>
          <Tooltip />
          <Legend
            verticalAlign="bottom"
            content={() => (
              <div className="hm-donut-legend" role="list" aria-label="样机状态图例">
                {data.map((entry, index) => (
                  <button
                    key={entry.status}
                    type="button"
                    className="hm-donut-legend__button"
                    aria-label={`${entry.name}：${entry.value} 台`}
                    aria-pressed={activeIndex === index}
                    onMouseEnter={() => setActiveIndex(index)}
                    onFocus={() => setActiveIndex(index)}
                    onBlur={() => setActiveIndex(null)}
                    onClick={() => setActiveIndex((current) => (current === index ? null : index))}
                  >
                    <span
                      className="hm-donut-legend__swatch"
                      style={{ backgroundColor: STATUS_CHART_COLORS[entry.status] }}
                      aria-hidden="true"
                    />
                    <span>{entry.name}</span>
                  </button>
                ))}
              </div>
            )}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="hm-chart-center" aria-hidden="true">
        <div
          key={activeDatum?.status ?? 'all'}
          className="hm-chart-center__content"
        >
          <span className="font-display text-3xl font-semibold tabular-nums">
            {activeDatum?.value ?? total}
          </span>
          <span className="text-xs text-muted-foreground">
            {activeDatum ? `${activeDatum.name}（台）` : '全部样机'}
          </span>
        </div>
      </div>
    </div>
  )
}
