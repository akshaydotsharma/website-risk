import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-xl border bg-card text-card-foreground shadow-sm transition-shadow duration-200",
      className
    )}
    {...props}
  />
));
Card.displayName = "Card";

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  tint?: "default" | "ai" | "risk" | "data" | "policy" | "info" | "success" | "warning";
}

const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(
  ({ className, tint, ...props }, ref) => {
    const tintClasses = {
      default: "",
      ai: "bg-ai-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
      risk: "bg-risk-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
      data: "bg-data-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
      policy: "bg-policy-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
      info: "bg-info-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
      success: "bg-success-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
      warning: "bg-warning-tint rounded-t-xl -mx-px -mt-px px-[calc(1.5rem+1px)] pt-[calc(1.5rem+1px)]",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-col space-y-1.5 p-6",
          tint && tintClasses[tint],
          className
        )}
        {...props}
      />
    );
  }
);
CardHeader.displayName = "CardHeader";

const CardTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className
    )}
    {...props}
  />
));
CardTitle.displayName = "CardTitle";

const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground leading-relaxed", className)}
    {...props}
  />
));
CardDescription.displayName = "CardDescription";

const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
));
CardContent.displayName = "CardContent";

const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props}
  />
));
CardFooter.displayName = "CardFooter";

const CardDivider = React.forwardRef<
  HTMLHRElement,
  React.HTMLAttributes<HTMLHRElement>
>(({ className, ...props }, ref) => (
  <hr
    ref={ref}
    className={cn("border-border/50 -mx-6 my-4", className)}
    {...props}
  />
));
CardDivider.displayName = "CardDivider";

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent, CardDivider };
