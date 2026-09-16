import type { ReactNode } from "react"
import type { LinkProps } from "react-router-dom"
import { Link } from "react-router-dom"
import { ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type SlideActionLinkProps = Omit<LinkProps, "children"> & {
  children: ReactNode
  className?: string
  variant?: "ghost" | "outline" | "link"
  size?: "sm" | "default"
}

function SlideActionLink({
  children,
  className,
  variant = "ghost",
  size = "sm",
  ...props
}: SlideActionLinkProps) {
  return (
    <Button
      asChild
      variant={variant}
      size={size}
      className={cn("group/slide-action overflow-hidden", className)}
    >
      <Link {...props}>
        <span className="relative inline-flex min-w-0 items-center gap-1">
          <ArrowRight
            className="size-3.5 -translate-x-2 opacity-0 transition-[opacity,transform] duration-short ease-hm-out group-hover/slide-action:translate-x-0 group-hover/slide-action:opacity-100 group-focus-visible/slide-action:translate-x-0 group-focus-visible/slide-action:opacity-100 motion-reduce:hidden"
            aria-hidden="true"
          />
          <span className="-translate-x-[1.125rem] whitespace-nowrap transition-transform duration-short ease-hm-out group-hover/slide-action:translate-x-0 group-focus-visible/slide-action:translate-x-0 motion-reduce:translate-x-0">
            {children}
          </span>
        </span>
      </Link>
    </Button>
  )
}

export { SlideActionLink }
