import { useState, type CSSProperties, type ImgHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

import './generative-loader.css'

const haloAngles = Array.from({ length: 8 }, (_, index) => index * 45)

interface HaloLoaderProps extends React.ComponentProps<'span'> {
  label?: string
  paused?: boolean
}

function HaloLoader({ className, label, paused = false, ...props }: HaloLoaderProps) {
  return (
    <span
      data-generative-loader="halo"
      data-paused={paused || undefined}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('gl-halo-loader size-4', className)}
      {...props}
    >
      <span className="gl-halo-loader__visual" aria-hidden="true">
        {haloAngles.map((angle, index) => (
          <i
            key={angle}
            style={{ '--gl-halo-angle': `${angle}deg`, '--gl-halo-index': index } as CSSProperties}
          />
        ))}
      </span>
    </span>
  )
}

interface ScanLoaderProps extends React.ComponentProps<'span'> {
  label?: string
  paused?: boolean
}

function ScanLoader({ className, label = '正在加载图片', paused = false, ...props }: ScanLoaderProps) {
  return (
    <span
      data-generative-loader="scan"
      data-paused={paused || undefined}
      role="status"
      aria-label={label}
      className={cn('gl-scan-loader size-28', className)}
      {...props}
    >
      <span className="gl-scan-loader__visual" aria-hidden="true">
        <i className="gl-scan-loader__fill" />
        <b className="gl-scan-loader__beam" />
        <em className="gl-scan-loader__frame" />
      </span>
    </span>
  )
}

interface ScanImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  containerClassName?: string
  loadingLabel?: string
}

function ScanImage({
  src,
  alt,
  className,
  containerClassName,
  loadingLabel = '正在加载图片',
  onLoad,
  onError,
  ...props
}: ScanImageProps) {
  const [imageState, setImageState] = useState<{
    source: ImgHTMLAttributes<HTMLImageElement>['src']
    status: 'loading' | 'ready' | 'error'
  }>({ source: src, status: 'loading' })
  const state = imageState.source === src ? imageState.status : 'loading'

  return (
    <span
      className={cn('gl-scan-image', containerClassName)}
      data-image-state={state}
      aria-busy={state === 'loading'}
    >
      <img
        {...props}
        src={src}
        alt={alt}
        className={cn('gl-scan-image__media', className)}
        onLoad={(event) => {
          setImageState({ source: src, status: 'ready' })
          onLoad?.(event)
        }}
        onError={(event) => {
          setImageState({ source: src, status: 'error' })
          onError?.(event)
        }}
      />
      {state === 'loading' && (
        <span className="gl-scan-image__loading">
          <ScanLoader className="gl-scan-image__loader" label={loadingLabel} />
        </span>
      )}
    </span>
  )
}

function PageLoader({ label = '正在加载页面' }: { label?: string }) {
  return (
    <div className="gl-page-loader" role="status" aria-live="polite">
      <HaloLoader className="size-10" />
      <span>{label}</span>
    </div>
  )
}

export { HaloLoader, PageLoader, ScanImage, ScanLoader }
