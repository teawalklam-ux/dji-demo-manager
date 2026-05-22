import { useState, useCallback, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { BARCODE_GENERATE_OPTIONS } from '@/lib/constants'

export function useBarcode() {
  const barcodeRef = useRef<SVGSVGElement>(null)

  const generateBarcode = useCallback((value: string) => {
    if (barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, value, {
          ...BARCODE_GENERATE_OPTIONS,
        })
      } catch (error) {
        console.error('Barcode generation failed:', error)
      }
    }
  }, [])

  const [scanning, setScanning] = useState(false)

  const startScan = useCallback(() => {
    setScanning(true)
  }, [])

  const stopScan = useCallback(() => {
    setScanning(false)
  }, [])

  return {
    barcodeRef,
    generateBarcode,
    scanning,
    startScan,
    stopScan,
  }
}
