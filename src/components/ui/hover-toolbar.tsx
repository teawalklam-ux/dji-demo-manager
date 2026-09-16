import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

function HoverToolbar({
  children,
  toolbar,
  className,
  toolbarClassName,
  label = "快捷操作",
}: {
  children: ReactNode
  toolbar?: ReactNode
  className?: string
  toolbarClassName?: string
  label?: string
}) {
  return (
    <div className={cn("hm-hover-toolbar", className)}>
      {children}
      {toolbar && (
        <div
          className={cn("hm-hover-toolbar__surface", toolbarClassName)}
          role="toolbar"
          aria-label={label}
        >
          {toolbar}
        </div>
      )}
    </div>
  )
}

export { HoverToolbar }
