import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Html5QrcodeSupportedFormats } from 'html5-qrcode'
import {
  classifyScanResult,
  getBarcodeScanProfile,
  getSelectableScanModes,
  isAcceptedScanResult,
  isSystemBarcode,
} from '../src/components/barcode/barcode-scan-profile.ts'

const scannerSource = readFileSync(
  new URL('../src/components/barcode/barcode-scanner.tsx', import.meta.url),
  'utf8',
)

const code128 = Html5QrcodeSupportedFormats.CODE_128
const qrCode = Html5QrcodeSupportedFormats.QR_CODE
const ean13 = Html5QrcodeSupportedFormats.EAN_13

const barcodeProfile = getBarcodeScanProfile('barcode')
assert.equal(barcodeProfile.engine, 'html5-qrcode')
assert.equal(barcodeProfile.html5Formats?.includes(code128), true)
assert.equal(barcodeProfile.html5Formats?.includes(ean13), true)
assert.equal(
  (barcodeProfile.html5Qrbox?.width || 0) > (barcodeProfile.html5Qrbox?.height || 0),
  true
)
assert.equal((barcodeProfile.systemFps || 0) > (barcodeProfile.html5Fps || 0), true)
assert.equal(barcodeProfile.cameraIdealWidth, 1920)
assert.equal(isAcceptedScanResult('barcode', 'DJI-20260527-0001', 'barcode'), true)
assert.equal(isAcceptedScanResult('barcode', 'DJI-20260527-0001', 'qr'), false)
assert.equal(isAcceptedScanResult('barcode', '5901234123457', 'barcode'), true)

const qrProfile = getBarcodeScanProfile('qrcode')
assert.equal(qrProfile.engine, 'qr-scanner')
assert.equal(qrProfile.qrInversionMode, 'both')
assert.equal((qrProfile.qrDownScaledSize || 0) >= 600, true)
assert.equal((qrProfile.qrScanRegionRatio || 0) >= 0.8, true)
assert.equal(isAcceptedScanResult('qrcode', 'https://example.test/item/1', 'qr'), true)
assert.equal(isAcceptedScanResult('qrcode', 'DJI-20260527-0001', 'barcode'), false)

const mixedProfile = getBarcodeScanProfile('mixed')
assert.equal(mixedProfile.engine, 'html5-qrcode')
assert.equal(mixedProfile.html5Formats?.includes(code128), true)
assert.equal(mixedProfile.html5Formats?.includes(qrCode), true)
assert.equal(mixedProfile.html5Formats?.includes(ean13), true)
assert.equal(isAcceptedScanResult('mixed', 'DJI-20260527-0001', 'barcode'), true)
assert.equal(isAcceptedScanResult('mixed', 'https://example.test/item/1', 'qr'), true)
assert.equal(isAcceptedScanResult('mixed', '', 'barcode'), false)

assert.equal(isSystemBarcode('DJI-20260527-0001'), true)
assert.equal(isSystemBarcode('5901234123457'), false)
assert.equal(classifyScanResult('DJI-20260527-0001', 'barcode'), 'system')
assert.equal(classifyScanResult('5901234123457', 'barcode'), 'generic')
assert.equal(classifyScanResult('https://example.test/item/1', 'qr'), 'qr')

assert.deepEqual(getSelectableScanModes(), ['barcode', 'mixed', 'qrcode'])

assert.match(scannerSource, /Math\.max\(scanProfile\.html5Fps[^]*scanProfile\.systemFps/)
assert.match(scannerSource, /enableContinuousFocus\(track\)/)
assert.match(scannerSource, /downScaledWidth: downScaledSize/)
assert.match(scannerSource, /torchFeature\(\)/)
assert.match(scannerSource, /scanner\.hasFlash\(\)/)
