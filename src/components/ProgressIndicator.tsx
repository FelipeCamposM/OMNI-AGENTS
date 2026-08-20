import { LoaderCircle } from "lucide-react";
import { useEnter } from "../lib/motion";

interface ProgressIndicatorProps {
  steps: string[];
  currentStep: number;
}

export function ProgressIndicator({ steps, currentStep }: ProgressIndicatorProps) {
  const label = steps[currentStep] ?? steps[0];
  const ref = useEnter<HTMLDivElement>();

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      aria-label={`Conversão em andamento: ${label}`}
      className="glass flex flex-col items-center gap-6 py-8"
    >
      <div className="relative w-12 h-12 animate-float">
        <LoaderCircle
          strokeWidth={2.5}
          aria-hidden="true"
          className="animate-spin w-12 h-12 text-accent"
        />
      </div>

      <div className="text-center space-y-1">
        <p className="text-text-primary font-medium text-sm">{label}</p>
        <p className="text-text-muted text-xs">Processamento local — pode levar alguns minutos</p>
      </div>

      <div className="flex gap-1.5" aria-hidden="true">
        {steps.map((_, i) => (
          <span
            key={i}
            className={[
              "h-1 rounded-full transition-all duration-500",
              i <= currentStep
                ? "w-6 bg-accent"
                : "w-3 bg-border",
            ].join(" ")}
          />
        ))}
      </div>
    </div>
  );
}
