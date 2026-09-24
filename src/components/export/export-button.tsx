import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Download } from 'lucide-react'

interface ExportButtonProps {
  onClick: () => void
  label?: string
  loading?: boolean
}

export function ExportButton({ onClick, label = '导出 Excel', loading }: ExportButtonProps) {
  return (
    <Button variant="outline" size="sm" onClick={onClick} disabled={loading}>
      {loading ? <Spinner className="mr-1 size-4" aria-hidden="true" /> : <Download className="mr-1 size-4" />}
      {loading ? '导出中...' : label}
    </Button>
  )
}
