import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

interface BarcodeGeneratorProps {
  value: string
  width?: number
  height?: number
  fontSize?: number
}

export function BarcodeGenerator({ value, width = 2, height = 60, fontSize = 14 }: BarcodeGeneratorProps) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (svgRef.current && value) {
      try {
        JsBarcode(svgRef.current, value, {
          format: 'CODE128',
          width,
          height,
          displayValue: true,
          fontSize,
          margin: 10,
        })
      } catch (error) {
        console.error('Barcode generation failed:', error)
      }
    }
  }, [value, width, height, fontSize])

  if (!value) return null

  return <svg ref={svgRef} />
}
