export function PageContainer({ children, className = "" }: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`max-w-6xl mx-auto px-4 md:px-8 lg:px-10 w-full ${className}`}>
      {children}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="text-stone-500 text-sm mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="flex items-center gap-2">{action}</div>}
    </div>
  );
}
