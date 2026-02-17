import { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const variantStyles: Record<Variant, string> = {
  primary: "bg-primary-600 text-white hover:bg-primary-700 border-primary-700 shadow-sm dark:bg-primary-500 dark:hover:bg-primary-600 dark:border-primary-600",
  secondary: "bg-white text-slate-700 hover:bg-slate-50 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 dark:border-slate-600",
  ghost: "bg-transparent text-slate-600 hover:bg-slate-100 border-transparent dark:text-slate-400 dark:hover:bg-slate-800",
  danger: "bg-danger-600 text-white hover:bg-red-700 border-red-700 shadow-sm dark:bg-red-600 dark:hover:bg-red-700 dark:border-red-700",
};

const sizeStyles: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...props
}: ButtonProps): JSX.Element {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg border font-semibold transition-all
        hover:shadow-sm active:translate-y-[1px]
        disabled:opacity-40 disabled:cursor-not-allowed ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
