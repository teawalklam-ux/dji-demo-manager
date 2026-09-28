import { useEffect, useMemo, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

const STATUS_CHART_COLORS = {
  in_stock: 'var(--color-chart-in-stock)',
  reserved: 'var(--color-chart-reserved)',
  borrowed: 'var(--color-chart-borrowed)',
  overdue: 'var(--color-chart-overdue)',
  maintenance: 'var(--color-chart-maintenance)',
  retired: 'var(--color-chart-retired)',
} as const

type StatusChartType = 'donut' | 'bar'

export interface StatusDistributionDatum {
  status: keyof typeof STATUS_CHART_COLORS
  name: string
  value: number
}

type StatusTooltipPayload = {
  color?: string
  payload?: StatusDistributionDatum
  value?: number | string
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

function StatusChartTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: StatusTooltipPayload[]
}) {
  const datum = payload?.[0]?.payload

  if (!active || !datum) return null

  return (
    <div className="hm-chart-tooltip">
      <span
        className="hm-chart-tooltip__swatch"
        style={{ backgroundColor: STATUS_CHART_COLORS[datum.status] }}
        aria-hidden="true"
      />
      <span>{datum.name}</span>
      <strong>{new Intl.NumberFormat('zh-CN').format(datum.value)} 台</strong>
    </div>
  )
}

function StatusLegend({
  data,
  activeIndex,
  onActivate,
  onClear,
}: {
  data: StatusDistributionDatum[]
  activeIndex: number | null
  onActivate: (index: number) => void
  onClear: () => void
}) {
  return (
    <div className="hm-donut-legend" role="list" aria-label="样机状态图例">
      {data.map((entry, index) => (
        <div key={entry.status} role="listitem">
          <button
            type="button"
            className="hm-donut-legend__button"
            aria-label={`${entry.name}：${entry.value} 台`}
            aria-pressed={activeIndex === index}
            onMouseEnter={() => onActivate(index)}
            onFocus={() => onActivate(index)}
            onBlur={onClear}
            onClick={() => activeIndex === index ? onClear() : onActivate(index)}
          >
            <span
              className="hm-donut-legend__swatch"
              style={{ backgroundColor: STATUS_CHART_COLORS[entry.status] }}
              aria-hidden="true"
            />
            <span>{entry.name}</span>
            <span className="sr-only">{entry.value} 台</span>
          </button>
        </div>
      ))}
    </div>
  )
}

export function StatusDistributionChart({
  data,
  total,
}: {
  data: StatusDistributionDatum[]
  total: number
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [chartType, setChartType] = useState<StatusChartType>('donut')
  const prefersReducedMotion = usePrefersReducedMotion()
  const activeDatum = activeIndex === null ? null : data[activeIndex]
  const chartConfig = useMemo<ChartConfig>(() => Object.fromEntries(
    data.map((entry) => [
      entry.status,
      { label: entry.name, color: STATUS_CHART_COLORS[entry.status] },
    ]),
  ), [data])
  const animationDuration = prefersReducedMotion ? 0 : 720

  function activate(index: number) {
    setActiveIndex(index)
  }

  function clearActive() {
    setActiveIndex(null)
  }

  return (
    <Tabs
      value={chartType}
      onValueChange={(value) => {
        setChartType(value as StatusChartType)
        clearActive()
      }}
      className="hm-chart-motion hm-status-charts"
      onMouseLeave={clearActive}
    >
      <div className="hm-chart-mode-row">
        <TabsList className="hm-chart-tabs-list" aria-label="图表展示方式">
          <TabsTrigger value="donut">圆环</TabsTrigger>
          <TabsTrigger value="bar">条形</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="donut" className="hm-chart-view">
        <div
          className="hm-chart-plot"
          role="group"
          aria-label={`样机状态分布圆环图：全部 ${total} 台`}
        >
          <ChartContainer config={chartConfig} className="hm-status-chart">
            <PieChart
              accessibilityLayer
              title="样机状态分布圆环图"
              desc={`显示全部 ${total} 台样机的当前状态分布`}
            >
              <Pie
                key={`donut-${chartType}`}
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={68}
                outerRadius={96}
                paddingAngle={6}
                cornerRadius={8}
                dataKey="value"
                nameKey="name"
                stroke="var(--color-paper)"
                strokeWidth={2}
                strokeLinecap="round"
                isAnimationActive={!prefersReducedMotion}
                animationBegin={0}
                animationDuration={animationDuration}
                animationEasing="ease-out"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={entry.status}
                    className={`hm-donut-segment${activeIndex === index ? ' is-active' : ''}`}
                    fill={STATUS_CHART_COLORS[entry.status]}
                    aria-label={`${entry.name}：${entry.value} 台`}
                    onMouseEnter={() => activate(index)}
                    onClick={() => activeIndex === index ? clearActive() : activate(index)}
                  />
                ))}
              </Pie>
              <Tooltip content={<StatusChartTooltip />} />
            </PieChart>
          </ChartContainer>
          <div className="hm-chart-center" aria-hidden="true">
            <div key={activeDatum?.status ?? 'all'} className="hm-chart-center__content">
              <span className="font-display text-3xl font-semibold tabular-nums">
                {activeDatum?.value ?? total}
              </span>
              <span className="text-xs text-muted-foreground">
                {activeDatum ? `${activeDatum.name}（台）` : '全部样机'}
              </span>
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="bar" className="hm-chart-view">
        <div
          className="hm-chart-plot"
          role="group"
          aria-label={`样机状态分布条形图：全部 ${total} 台`}
        >
          <ChartContainer config={chartConfig} className="hm-status-chart">
            <BarChart
              accessibilityLayer
              data={data}
              layout="vertical"
              margin={{ top: 8, right: 48, bottom: 8, left: 8 }}
              title="样机状态分布条形图"
              desc={`按状态比较全部 ${total} 台样机的数量`}
            >
              <CartesianGrid horizontal={false} strokeDasharray="3 3" />
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tickMargin={8}
                width={64}
              />
              <Tooltip
                cursor={{ fill: 'var(--color-paper-3)' }}
                content={<StatusChartTooltip />}
              />
              <Bar
                key={`bar-${chartType}`}
                dataKey="value"
                maxBarSize={24}
                radius={[0, 8, 8, 0]}
                isAnimationActive={!prefersReducedMotion}
                animationBegin={0}
                animationDuration={animationDuration}
                animationEasing="ease-out"
              >
                {data.map((entry, index) => (
                  <Cell
                    key={entry.status}
                    className={`hm-status-bar${activeIndex === index ? ' is-active' : ''}`}
                    fill={STATUS_CHART_COLORS[entry.status]}
                    onMouseEnter={() => activate(index)}
                    onClick={() => activeIndex === index ? clearActive() : activate(index)}
                  />
                ))}
                <LabelList dataKey="value" position="right" className="hm-status-bar__label" />
              </Bar>
            </BarChart>
          </ChartContainer>
        </div>
      </TabsContent>

      <StatusLegend
        data={data}
        activeIndex={activeIndex}
        onActivate={activate}
        onClear={clearActive}
      />
    </Tabs>
  )
}
