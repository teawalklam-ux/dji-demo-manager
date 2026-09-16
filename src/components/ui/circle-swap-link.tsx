import type { ReactNode } from "react"
import type { LinkProps } from "react-router-dom"
import { ArrowRight } from "lucide-react"
import { Link } from "react-router-dom"

import { cn } from "@/lib/utils"

type CircleSwapLinkProps = Omit<LinkProps, "children"> & {
  children: ReactNode
  className?: string
}

function CircleSwapLink({ children, className, ...props }: CircleSwapLinkProps) {
  return (
    <Link className={cn("hm-circle-swap", className)} {...props}>
      <span className="hm-circle-swap__label">{children}</span>
      <span className="hm-circle-swap__dot" aria-hidden="true" />
      <span className="hm-circle-swap__arrow" aria-hidden="true">
        <ArrowRight />
      </span>
    </Link>
  )
}

export { CircleSwapLink }
