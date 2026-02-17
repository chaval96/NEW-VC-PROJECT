import { InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", ...props }: InputProps): JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      {label && <label className="text-xs font-medium text-slate-500">{label}</label>}
      <input
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
          placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2
          focus:ring-primary-500/20 transition-colors ${className}`}
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
      {label && <label className="text-xs font-medium text-slate-500">{label}</label>}
      <textarea
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
          placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2
          focus:ring-primary-500/20 transition-colors resize-vertical ${className}`}
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
      {label && <label className="text-xs font-medium text-slate-500">{label}</label>}
      <select
        className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm
          focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20
          transition-colors ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
