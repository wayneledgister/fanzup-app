import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Brand §8: primary = gold fill + BLACK text (never white on gold), 8px radius,
 * hover champagne sheen, pressed gold-deep. Secondary = transparent + hairline.
 * Destructive = error red, white text — always confirm before acting.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-sans font-semibold transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold",
  {
    variants: {
      variant: {
        primary: "bg-gold text-on-gold hover:bg-gold-champagne active:bg-gold-deep",
        secondary: "border border-line bg-transparent text-fg hover:bg-surface-2 hover:border-muted/50",
        ghost: "bg-transparent text-muted hover:text-fg hover:bg-surface-2",
        destructive: "bg-error text-white hover:bg-error/90",
        link: "h-auto px-0 text-gold underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-9 px-3 text-sm",
        md: "h-11 px-5 text-sm",
        lg: "h-12 px-6 text-base",
        icon: "size-11",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, block, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size, block }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
