import { Button, ResultPanel } from "./ui";

interface ActionBarProps {
  savedPath: string | null;
  durationMs: number;
  onSave: () => void;
  onReset: () => void;
}

export function ActionBar({ savedPath, durationMs, onSave, onReset }: ActionBarProps) {
  const seconds = (durationMs / 1000).toFixed(1);

  return (
    <div className="space-y-3">
      {/* Salvo: mesmo painel das outras ferramentas — ele já traz copiar
          caminho e abrir pasta, então some o botão "Abrir pasta" daqui. */}
      {savedPath ? (
        <ResultPanel paths={[savedPath]} label="Arquivo salvo" />
      ) : (
        <p className="text-text-muted text-xs text-center">
          Conversão concluída em {seconds}s — escolha onde salvar
        </p>
      )}

      <div className="flex gap-2 flex-wrap">
        {!savedPath && (
          <Button variant="primary" className="flex-1 min-w-[140px]" onClick={onSave}>
            Salvar .md
          </Button>
        )}

        <Button variant="ghost" className="flex-1 min-w-[140px]" onClick={onReset}>
          Converter outro PDF
        </Button>
      </div>
    </div>
  );
}

