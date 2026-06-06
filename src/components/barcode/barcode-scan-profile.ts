import { Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { BARCODE_PREFIX } from '../../lib/constants'

export type BarcodeScanMode = 'barcode' | 'qrcode' | 'mixed'

export interface BarcodeScanProfile {
  /** 条形码模式：使用 html5-qrcode */
  html5Formats?: Html5QrcodeSupportedFormats[]
  html5Qrbox?: { width: number; height: number }
  html5Fps?: number
  /** 二维码模式：使用 qr-scanner */
  qrMaxScansPerSecond?: number
  qrInversionMode?: 'original' | 'invert' | 'both'
  /** 使用哪个引擎 */
  engine: 'html5-qrcode' | 'qr-scanner'
  title: string
  helpText: string
  placeholder: string
  mismatchMessage: string
}

const systemBarcodePattern = new RegExp(`^${escapeRegExp(BARCODE_PREFIX)}-\\d{8}-\\d{4}$`)

const code128 = Html5QrcodeSupportedFormats.CODE_128

const scanProfiles: Record<BarcodeScanMode, BarcodeScanProfile> = {
  barcode: {
    engine: 'html5-qrcode',
    html5Formats: [code128],
    html5Qrbox: { width: 280, height: 160 },
    html5Fps: 20,
    title: '扫描条形码',
    helpText: `系统条码格式：${BARCODE_PREFIX}-YYYYMMDD-XXXX，请将条码对准横向扫描框`,
    placeholder: '输入条码或序列号',
    mismatchMessage: `未识别到有效的系统条形码，请对准 ${BARCODE_PREFIX} 条码或切换扫描模式`,
  },
  qrcode: {
    engine: 'qr-scanner',
    qrMaxScansPerSecond: 15,
    qrInversionMode: 'both',
    title: '扫描二维码',
    helpText: '请将二维码完整放入方形扫描框（支持反色二维码）',
    placeholder: '输入二维码内容',
    mismatchMessage: '当前为二维码模式，请对准二维码或切换扫描模式',
  },
  mixed: {
    engine: 'html5-qrcode',
    html5Formats: [code128, Html5QrcodeSupportedFormats.QR_CODE],
    html5Qrbox: { width: 260, height: 220 },
    html5Fps: 15,
    title: '扫描条形码 / 二维码',
    helpText: '兼容模式同时识别条码和二维码',
    placeholder: '输入条码、二维码内容或序列号',
    mismatchMessage: '未识别到当前模式支持的码，请调整位置或切换扫描模式',
  },
}

export function getBarcodeScanProfile(mode: BarcodeScanMode): BarcodeScanProfile {
  return scanProfiles[mode]
}

export function getSelectableScanModes(): readonly BarcodeScanMode[] {
  return ['barcode', 'qrcode']
}

/**
 * 判断扫描结果是否可接受
 * - barcode 模式: 只接受系统条码格式 (CODE128)
 * - qrcode 模式: 接受所有二维码
 * - mixed 模式: 接受系统条码或二维码
 */
export function isAcceptedScanResult(
  mode: BarcodeScanMode,
  decodedText: string,
  source: 'qr' | 'barcode'
): boolean {
  const text = decodedText.trim()
  if (!text) return false

  if (mode === 'barcode') {
    return source === 'barcode' && isSystemBarcode(text)
  }

  if (mode === 'qrcode') {
    return source === 'qr'
  }

  // mixed
  return (source === 'barcode' && isSystemBarcode(text)) || source === 'qr'
}

export function isSystemBarcode(value: string): boolean {
  return systemBarcodePattern.test(value.trim())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
