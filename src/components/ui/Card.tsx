interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = "", hover }: CardProps): JSX.Element {
  return (
    <div className={`overflow-hidden rounded-xl border border-slate-200/90 bg-white shadow-sm
      dark:border-slate-700 dark:bg-slate-800
      ${hover ? "transition-all hover:-translate-y-0.5 hover:shadow-md" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }): JSX.Element {
  return (
    <div className={`border-b border-slate-100 bg-slate-50/70 px-5 py-4 dark:border-slate-700 dark:bg-slate-800/80 ${className}`}>
      {children}
    </div>
  );
}

export function CardBody({ children, className = "" }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
