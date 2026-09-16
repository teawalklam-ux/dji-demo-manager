import type { ReactNode } from "react"
import type { LinkProps } from "react-router-dom"
import { ArrowRight, type LucideIcon } from "lucide-react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"

type UnderlineActionLinkProps = Omit<LinkProps, "children"> & {
  children: ReactNode
  className?: string
  icon?: LucideIcon
}

function UnderlineActionLink({
  children,
  className,
  icon: Icon = ArrowRight,
  ...props
}: UnderlineActionLinkProps) {
  return (
    <Link className={cn("hm-underline-action", className)} {...props}>
      <span className="hm-underline-action__icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="hm-underline-action__copy">
        <span>{children}</span>
        <span className="hm-underline-action__line" aria-hidden="true" />
      </span>
    </Link>
  )
}

export { UnderlineActionLink }
