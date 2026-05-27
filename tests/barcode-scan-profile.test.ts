import assert from 'node:assert/strict'
import { Html5QrcodeSupportedFormats } from 'html5-qrcode'
import {
  getBarcodeScanProfile,
  getSelectableScanModes,
  isAcceptedScanResult,
} from '../src/components/barcode/barcode-scan-profile'

const code128 = Html5QrcodeSupportedFormats.CODE_128
const qrCode = Html5QrcodeSupportedFormats.QR_CODE
const ean13 = Html5QrcodeSupportedFormats.EAN_13

assert.deepEqual(getBarcodeScanProfile('barcode').formatsToSupport, [code128])
assert.equal(getBarcodeScanProfile('barcode').qrbox.width > getBarcodeScanProfile('barcode').qrbox.height, true)
assert.equal(isAcceptedScanResult('barcode', 'DJI-20260527-0001', code128), true)
assert.equal(isAcceptedScanResult('barcode', 'DJI-20260527-0001', qrCode), false)
assert.equal(isAcceptedScanResult('barcode', 'ABC-20260527-0001', code128), false)

assert.deepEqual(getBarcodeScanProfile('qrcode').formatsToSupport, [qrCode])
assert.equal(getBarcodeScanProfile('qrcode').qrbox.width, getBarcodeScanProfile('qrcode').qrbox.height)
assert.equal(isAcceptedScanResult('qrcode', 'DJI-20260527-0001', qrCode), true)
assert.equal(isAcceptedScanResult('qrcode', 'DJI-20260527-0001', code128), false)

assert.deepEqual(getBarcodeScanProfile('mixed').formatsToSupport, [code128, qrCode])
assert.equal(isAcceptedScanResult('mixed', 'DJI-20260527-0001', code128), true)
assert.equal(isAcceptedScanResult('mixed', 'https://example.test/item/1', qrCode), true)
assert.equal(isAcceptedScanResult('mixed', '5901234123457', ean13), false)

assert.deepEqual(getSelectableScanModes(), ['barcode', 'qrcode'])
