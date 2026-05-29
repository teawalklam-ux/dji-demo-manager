/**
 * Canvas 水印绘制工具
 * 在照片上叠加时间戳 + GPS 坐标/地址水印
 */

interface WatermarkData {
  timestamp: Date
  latitude: number | null
  longitude: number | null
  address?: string
}

/**
 * 在 canvas 上绘制水印（烧入图片）
 * 水印位于底部，半透明黑色背景 + 白色文字
 * - 第一行: 时间戳 YYYY-MM-DD HH:mm:ss
 * - 第二行: 经纬度坐标 + 地址（如有）
 */
export function drawWatermark(
  canvas: HTMLCanvasElement,
  data: WatermarkData
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const { timestamp, latitude, longitude, address } = data

  // 自适应字号：基于 canvas 宽度
  const fontSize = Math.max(14, Math.round(canvas.width * 0.032))
  const lineHeight = fontSize * 1.4
  const padding = fontSize * 0.8

  // 格式化时间戳
  const timeStr = formatTimestamp(timestamp)

  // 格式化坐标行
  let coordLine = ''
  if (latitude !== null && longitude !== null) {
    coordLine = formatCoordinates(latitude, longitude)
    if (address) {
      coordLine += ` | ${address}`
    }
  } else {
    coordLine = 'GPS 不可用'
  }

  // 计算水印区域高度
  const textLines = coordLine ? [timeStr, coordLine] : [timeStr]
  const barHeight = padding * 2 + textLines.length * lineHeight

  // 绘制半透明背景条
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(0, canvas.height - barHeight, canvas.width, barHeight)

  // 绘制文字
  ctx.fillStyle = '#FFFFFF'
  ctx.font = `${fontSize}px "Courier New", monospace`
  ctx.textBaseline = 'top'

  textLines.forEach((line, index) => {
    const y = canvas.height - barHeight + padding + index * lineHeight
    ctx.fillText(line, padding, y)
  })
}

/**
 * 格式化时间戳: YYYY-MM-DD HH:mm:ss
 */
function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  )
}

/**
 * 格式化坐标: 31.2304N, 121.4737E
 */
function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}${latDir}, ${Math.abs(lng).toFixed(4)}${lngDir}`
}
