import { CircleAlert } from "lucide-react";
import { useShake } from "../lib/motion";
import { Button } from "./ui";

interface ErrorDisplayProps {
  message: string;
  errorCode?: string;
  onRetry?: () => void;
  onReset: () => void;
}

export function ErrorDisplay({ message, onRetry, onReset }: ErrorDisplayProps) {
  const ref = useShake<HTMLDivElement>(message);

  return (
    <div
      ref={ref}
      role="alert"
      className="glass !border-danger/40 bg-danger/10 p-6 space-y-4"
    >
      <div className="flex gap-3">
        <CircleAlert className="w-5 h-5 text-danger shrink-0 mt-0.5" aria-hidden="true" />
        <div className="space-y-1">
          <p className="text-danger font-medium text-sm">Erro na conversão</p>
          <p className="text-text-secondary text-sm">{message}</p>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        {onRetry && <Button onClick={onRetry}>Tentar novamente</Button>}
        <Button variant="ghost" onClick={onReset}>
          Escolher outro arquivo
        </Button>
      </div>
    </div>
  );
}

