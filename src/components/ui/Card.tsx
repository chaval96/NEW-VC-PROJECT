interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
}

export function Card({ children, className = "", hover }: CardProps): JSX.Element {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white shadow-sm
      dark:border-slate-700 dark:bg-slate-800
      ${hover ? "hover:shadow-md transition-shadow" : ""} ${className}`}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "" }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={`px-5 py-4 border-b border-slate-100 dark:border-slate-700 ${className}`}>{children}</div>;
}

export function CardBody({ children, className = "" }: { children: React.ReactNode; className?: string }): JSX.Element {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
}
