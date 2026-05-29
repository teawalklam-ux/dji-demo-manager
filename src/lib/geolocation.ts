/**
 * GPS 定位工具
 * 获取当前位置坐标，尽力获取地址但不阻塞流程
 */

export interface GeoLocation {
  latitude: number
  longitude: number
  address?: string
}

/**
 * 获取当前 GPS 位置
 * 超时 10 秒，启用高精度
 * 返回 null 表示定位失败
 */
export async function getCurrentLocation(): Promise<GeoLocation | null> {
  if (!navigator.geolocation) {
    console.warn('[geolocation] Geolocation API 不可用')
    return null
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
      },
      (error) => {
        console.warn('[geolocation] 定位失败:', error.message)
        resolve(null)
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      }
    )
  })
}

/**
 * 格式化坐标为可读文本
 * 格式: 31.2304N, 121.4737E
 */
export function formatCoordinates(lat: number, lng: number): string {
  const latDir = lat >= 0 ? 'N' : 'S'
  const lngDir = lng >= 0 ? 'E' : 'W'
  return `${Math.abs(lat).toFixed(4)}${latDir}, ${Math.abs(lng).toFixed(4)}${lngDir}`
}
