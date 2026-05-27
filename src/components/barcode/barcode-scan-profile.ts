import { Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { BARCODE_PREFIX } from '../../lib/constants'

export type BarcodeScanMode = 'barcode' | 'qrcode' | 'mixed'

export interface BarcodeScanProfile {
  formatsToSupport: readonly Html5QrcodeSupportedFormats[]
  qrbox: {
    width: number
    height: number
  }
  aspectRatio: number
  fps: number
  title: string
  helpText: string
  placeholder: string
  mismatchMessage: string
}

const code128 = Html5QrcodeSupportedFormats.CODE_128
const qrCode = Html5QrcodeSupportedFormats.QR_CODE
const systemBarcodePattern = new RegExp(`^${escapeRegExp(BARCODE_PREFIX)}-\\d{8}-\\d{4}$`)

const scanProfiles: Record<BarcodeScanMode, BarcodeScanProfile> = {
  barcode: {
    formatsToSupport: [code128],
    qrbox: { width: 280, height: 160 },
    aspectRatio: 1.778,
    fps: 20,
    title: '扫描条形码',
    helpText: `系统条码格式：${BARCODE_PREFIX}-YYYYMMDD-XXXX，请将条码对准横向扫描框`,
    placeholder: '输入条码或序列号',
    mismatchMessage: `未识别到有效的系统条形码，请对准 ${BARCODE_PREFIX} 条码或切换扫描模式`,
  },
  qrcode: {
    formatsToSupport: [qrCode],
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1,
    fps: 15,
    title: '扫描二维码',
    helpText: '请将二维码完整放入方形扫描框',
    placeholder: '输入二维码内容',
    mismatchMessage: '当前为二维码模式，请对准二维码或切换扫描模式',
  },
  mixed: {
    formatsToSupport: [code128, qrCode],
    qrbox: { width: 260, height: 220 },
    aspectRatio: 1.333,
    fps: 15,
    title: '扫描条形码 / 二维码',
    helpText: '兼容模式会同时识别系统条码和二维码',
    placeholder: '输入条码、二维码内容或序列号',
    mismatchMessage: '未识别到当前模式支持的码，请调整位置或切换扫描模式',
  },
}

export function getBarcodeScanProfile(mode: BarcodeScanMode): BarcodeScanProfile {
  return scanProfiles[mode]
}

export function isAcceptedScanResult(
  mode: BarcodeScanMode,
  decodedText: string,
  format?: Html5QrcodeSupportedFormats
): boolean {
  const text = decodedText.trim()
  if (!text || format === undefined) return false

  if (mode === 'barcode') {
    return format === code128 && isSystemBarcode(text)
  }

  if (mode === 'qrcode') {
    return format === qrCode
  }

  return (format === code128 && isSystemBarcode(text)) || format === qrCode
}

export function isSystemBarcode(value: string): boolean {
  return systemBarcodePattern.test(value.trim())
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
