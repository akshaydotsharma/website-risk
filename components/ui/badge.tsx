import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground",
        secondary:
          "bg-muted text-muted-foreground",
        destructive:
          "bg-destructive text-destructive-foreground",
        outline: "border border-border text-foreground bg-card",
        success:
          "bg-success text-success-foreground",
        warning:
          "bg-warning text-warning-foreground",
        caution:
          "bg-caution text-caution-foreground",
        // Subtle variants (tinted backgrounds)
        "success-subtle":
          "bg-success-tint text-success",
        "warning-subtle":
          "bg-warning-tint text-warning",
        "danger-subtle":
          "bg-danger-tint text-destructive",
        "info-subtle":
          "bg-info-tint text-primary",
      },
      size: {
        default: "px-2.5 py-0.5 text-xs",
        sm: "px-1.5 py-0 text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
