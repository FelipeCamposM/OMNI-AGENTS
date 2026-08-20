/**
 * Barra de progresso da transcrição/queima.
 *
 * Antes do 1º PROGRESS a barra é **indeterminada**, não 0%. Carregar (ou
 * baixar) o modelo leva de segundos a minutos sem gerar progresso nenhum, e
 * "0%" parado nessa janela faz o usuário concluir que travou.
 */
export function ProgressoTranscricao({
  progresso,
  etapa,
  aviso,
}: {
  progresso: number;
  etapa: string | null;
  aviso?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="glass-inset h-2 rounded-full overflow-hidden">
        {progresso > 0 ? (
          <div
            className="shimmer h-full bg-selected transition-all duration-300"
            style={{ width: `${progresso}%` }}
            role="progressbar"
            aria-valuenow={progresso}
          />
        ) : (
          <div
            className="shimmer h-full w-full bg-selected/30"
            role="progressbar"
            aria-label="Preparando"
          />
        )}
      </div>
      <p className="text-text-muted text-[11px] text-center">
        {etapa ?? "Processando…"}
        {progresso > 0 && ` — ${progresso}%`}
      </p>
      {progresso === 0 && aviso && (
        <p className="text-text-muted text-[11px] text-center">{aviso}</p>
      )}
    </div>
  );
}
