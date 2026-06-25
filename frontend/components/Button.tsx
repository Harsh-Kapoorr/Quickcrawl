"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "ghost"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-fg text-fg-inverse hover:bg-white disabled:bg-fg-faint disabled:text-fg-inverse",
  secondary:
    "bg-surface border border-border text-fg hover:border-border-strong hover:bg-surface-hi disabled:opacity-50",
  ghost:
    "text-fg-muted hover:text-fg hover:bg-surface disabled:opacity-50",
  danger:
    "bg-surface border border-err/40 text-err hover:bg-err/10 disabled:opacity-50",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-7 px-2.5 text-xs gap-1.5 rounded-md",
  md: "h-9 px-3.5 text-sm gap-2 rounded-md",
  lg: "h-11 px-5 text-sm gap-2 rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading = false,
      disabled,
      icon,
      iconRight,
      children,
      type = "button",
      ...rest
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        className={cn(
          "inline-flex items-center justify-center font-medium",
          "transition-colors duration-100",
          "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
          "disabled:cursor-not-allowed",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <span
            aria-hidden
            className="inline-block h-3.5 w-3.5 animate-spin-slow rounded-full border-[1.5px] border-current border-t-transparent"
          />
        ) : icon ? (
          <span aria-hidden className="inline-flex shrink-0">
            {icon}
          </span>
        ) : null}
        {children && <span>{children}</span>}
        {iconRight && !loading && (
          <span aria-hidden className="inline-flex shrink-0">
            {iconRight}
          </span>
        )}
      </button>
    );
  },
);
Button.displayName = "Button";