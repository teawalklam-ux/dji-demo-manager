import { Html5QrcodeSupportedFormats } from 'html5-qrcode'
import { BARCODE_PREFIX } from '../../lib/constants'

export type BarcodeScanMode = 'barcode' | 'qrcode' | 'mixed'

/**
 * 扫描结果分类
 * - system: 系统条码 (DJI-YYYYMMDD-XXXX)，走快速通道
 * - generic: 通用条码 (EAN/UPC/Code39 等)，需多次确认防误读
 * - qr: 二维码
 */
export type BarcodeScanKind = 'system' | 'generic' | 'qr'

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
  /** 系统条码专属 fps（快速识别，高于通用 fps） */
  systemFps?: number
  /** 非系统条码需连续多少次相同结果才接受（防误读）；1 表示立即接受 */
  genericConfirmCount?: number
  /** 非系统条码确认后延迟关闭弹窗的毫秒数（让用户看到反馈） */
  genericCloseDelayMs?: number
}

const systemBarcodePattern = new RegExp(`^${escapeRegExp(BARCODE_PREFIX)}-\\d{8}-\\d{4}$`)

/**
 * 通用条形码格式集合
 * - CODE_128: 系统条码使用
 * - EAN_13 / EAN_8: 商品条码（食品、日用品等）
 * - UPC_A / UPC_E: 北美商品条码
 * - CODE_39: 工业用条码
 * - CODE_93: 物流用条码
 * - ITF: 包装箱条码
 * - CODABAR: 图书馆/医疗用条码
 */
const commonBarcodeFormats: Html5QrcodeSupportedFormats[] = [
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.CODE_93,
  Html5QrcodeSupportedFormats.ITF,
  Html5QrcodeSupportedFormats.CODABAR,
]

const scanProfiles: Record<BarcodeScanMode, BarcodeScanProfile> = {
  barcode: {
    engine: 'html5-qrcode',
    html5Formats: commonBarcodeFormats,
    html5Qrbox: { width: 280, height: 160 },
    html5Fps: 15,
    systemFps: 25,
    genericConfirmCount: 2,
    genericCloseDelayMs: 500,
    title: '扫描条形码',
    helpText: `系统条码 ${BARCODE_PREFIX}-YYYYMMDD-XXXX 优先快速识别；同时支持 EAN/UPC/Code39 等通用条码`,
    placeholder: '输入条码或序列号',
    mismatchMessage: '未识别到条形码，请对准条码或调整距离',
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
    html5Formats: [...commonBarcodeFormats, Html5QrcodeSupportedFormats.QR_CODE],
    html5Qrbox: { width: 260, height: 220 },
    html5Fps: 15,
    systemFps: 25,
    genericConfirmCount: 2,
    genericCloseDelayMs: 500,
    title: '扫描条形码 / 二维码',
    helpText: '兼容模式同时识别条码和二维码，系统条码优先快速识别',
    placeholder: '输入条码、二维码内容或序列号',
    mismatchMessage: '未识别到码，请调整位置或切换扫描模式',
  },
}

export function getBarcodeScanProfile(mode: BarcodeScanMode): BarcodeScanProfile {
  return scanProfiles[mode]
}

/** 暴露全部三种模式供扫描器切换（含 mixed 兼容模式） */
export function getSelectableScanModes(): readonly BarcodeScanMode[] {
  return ['barcode', 'mixed', 'qrcode']
}

/**
 * 判断扫描结果是否可接受（引擎识别成功即接受，不再强制要求系统条码）
 * - barcode 模式: 接受所有条形码（系统条码走快速通道，通用条码需确认）
 * - qrcode 模式: 接受所有二维码
 * - mixed 模式: 接受条形码或二维码
 */
export function isAcceptedScanResult(
  mode: BarcodeScanMode,
  decodedText: string,
  source: 'qr' | 'barcode'
): boolean {
  const text = decodedText.trim()
  if (!text) return false

  if (mode === 'barcode') {
    return source === 'barcode'
  }

  if (mode === 'qrcode') {
    return source === 'qr'
  }

  // mixed: 条码或二维码都接受
  return true
}

/** 判断是否为系统条码 (DJI-YYYYMMDD-XXXX) */
export function isSystemBarcode(value: string): boolean {
  return systemBarcodePattern.test(value.trim())
}

/**
 * 根据扫描结果分类，用于 UI 反馈和分流处理
 * - system: 系统条码（快速通道，立即返回）
 * - generic: 通用条码（需多次确认）
 * - qr: 二维码
 */
export function classifyScanResult(
  text: string,
  source: 'qr' | 'barcode'
): BarcodeScanKind {
  if (source === 'qr') return 'qr'
  return isSystemBarcode(text) ? 'system' : 'generic'
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
