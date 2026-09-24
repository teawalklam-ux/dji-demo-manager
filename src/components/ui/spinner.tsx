import { HaloLoader } from '@/components/ui/generative-loader'

function Spinner({ className, ...props }: React.ComponentProps<'span'>) {
  const hidden = props['aria-hidden'] === true || props['aria-hidden'] === 'true'
  const label = hidden ? undefined : String(props['aria-label'] || '加载中')

  return <HaloLoader className={className} label={label} {...props} />
}

export { Spinner }
