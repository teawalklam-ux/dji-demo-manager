import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'
import { BARCODE_GENERATE_OPTIONS } from '@/lib/constants'

interface BarcodeGeneratorProps {
  value: string
}

export function BarcodeGenerator({ value }: BarcodeGeneratorProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          ...BARCODE_GENERATE_OPTIONS,
        })
      } catch (error) {
        console.error('Barcode generation failed:', error)
      }
    }
  }, [value])

  if (!value) return null

  return <svg ref={svgRef} />
}
