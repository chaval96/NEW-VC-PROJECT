interface Step { label: string; }

interface ProgressStepsProps {
  steps: Step[];
  currentStep: number;
}

export function ProgressSteps({ steps, currentStep }: ProgressStepsProps): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      {steps.map((step, i) => {
        const done = i < currentStep;
        const active = i === currentStep;
        return (
          <div key={step.label} className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-colors
              ${done ? "bg-primary-600 text-white" : active ? "ring-2 ring-primary-500 bg-white text-primary-600" : "bg-slate-100 text-slate-400"}`}
            >
              {done ? "✓" : i + 1}
            </div>
            <span className={`text-sm hidden sm:inline ${active ? "font-semibold text-slate-900" : "text-slate-500"}`}>
              {step.label}
            </span>
            {i < steps.length - 1 && <div className="w-8 h-px bg-slate-300" />}
          </div>
        );
      })}
    </div>
  );
}
