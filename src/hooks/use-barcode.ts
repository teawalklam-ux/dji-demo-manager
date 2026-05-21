import { useState, useCallback, useRef } from 'react'
import JsBarcode from 'jsbarcode'

export function useBarcode() {
  const barcodeRef = useRef<SVGSVGElement>(null)

  const generateBarcode = useCallback((value: string) => {
    if (barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, value, {
          format: 'CODE128',
          width: 2,
          height: 60,
          displayValue: true,
          fontSize: 14,
          margin: 10,
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
