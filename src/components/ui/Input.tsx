import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", ...props }: InputProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>}
      <input
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
          placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2
          focus:ring-primary-500/20 transition-colors
          dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500
          dark:focus:border-primary-400 dark:focus:ring-primary-400/20 ${className}`}
        {...props}
      />
    </div>
  );
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export function Textarea({ label, className = "", ...props }: TextareaProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>}
      <textarea
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
          placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2
          focus:ring-primary-500/20 transition-colors resize-vertical
          dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500
          dark:focus:border-primary-400 dark:focus:ring-primary-400/20 ${className}`}
        {...props}
      />
    </div>
  );
}

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
}

export function Select({ label, className = "", children, ...props }: SelectProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>}
      <select
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
          focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20
          transition-colors dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100
          dark:focus:border-primary-400 dark:focus:ring-primary-400/20 ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
