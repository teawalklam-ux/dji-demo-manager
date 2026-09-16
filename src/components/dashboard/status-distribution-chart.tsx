import { useState } from 'react'
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

export function StatusDistributionChart({
  data,
  total,
}: {
  data: StatusDistributionDatum[]
  total: number
}) {
  const [animationRun, setAnimationRun] = useState(0)

  return (
    <div
      className="hm-chart-motion relative h-[17.5rem] min-w-0"
      role="img"
      aria-label={`样机状态分布：全部 ${total} 台`}
      onMouseEnter={() => setAnimationRun((current) => current + 1)}
    >
      <ResponsiveContainer key={`pie-${animationRun}`} width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="45%"
            innerRadius={68}
            outerRadius={96}
            paddingAngle={3}
            dataKey="value"
            stroke="var(--color-paper)"
            strokeWidth={2}
            isAnimationActive={false}
          >
            {data.map((entry) => (
              <Cell key={entry.status} fill={STATUS_CHART_COLORS[entry.status]} />
            ))}
          </Pie>
          <Tooltip />
          <Legend verticalAlign="bottom" iconType="circle" iconSize={8} />
        </PieChart>
      </ResponsiveContainer>
      <div className="hm-chart-center" aria-hidden="true">
        <span className="font-display text-3xl font-semibold tabular-nums">{total}</span>
        <span className="text-xs text-muted-foreground">全部样机</span>
      </div>
    </div>
  )
}
