import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'

interface ExportButtonProps {
  onClick: () => void
  label?: string
  loading?: boolean
}

export function ExportButton({ onClick, label = '导出 Excel', loading }: ExportButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      <Download className="mr-1 h-4 w-4" />
      {loading ? '导出中...' : label}
    </Button>
  )
}
