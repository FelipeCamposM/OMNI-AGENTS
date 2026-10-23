import { useEffect, useState } from "react";
import { Button } from "../components/ui/Button";
import { Modal } from "../components/ui/Modal";
import { Select } from "../components/ui/Select";
import { AgentIcon } from "../components/ui/AgentIcon";
import { CopyIcon, SendIcon } from "../components/ui/PixelIcon";
import { request, type Projects } from "./api";

const rota = (id: string) => `/conversas/${encodeURIComponent(id)}/exportar`;

/**
 * "Exportar para outro agente": a conversa vira um pacote de contexto em Markdown
 * (`.omni/exports/…md`) e uma conversa nova abre no agente escolhido, começando por ele. A original
 * fica como está. "Copiar como Markdown" leva o mesmo pacote para colar em qualquer lugar.
 */
export function ExportarConversa({ conversaId, provider, abrir }: {
  conversaId: string; provider?: string | null;
  /** Web/celular: vai para a conversa nova. No PC ela aparece em CHATS, na lateral. */
  abrir?: (novaId: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [catalogo, setCatalogo] = useState<Projects | null>(null);
  const [agente, setAgente] = useState("");
  const [conta, setConta] = useState("");
  const [busy, setBusy] = useState<"exportar" | "copiar" | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || catalogo) return;
    request<Projects>("/projetos").then((c) => {
      setCatalogo(c);
      // Sugere outro agente que não o desta conversa: é para isso que se exporta.
      setAgente((atual) => atual || (c.agents.find((a) => a.id !== provider) ?? c.agents[0])?.id || "");
    }).catch((motivo) => setErro(String(motivo)));
  }, [aberto, catalogo, provider]);

  function fechar() { setAberto(false); setErro(null); setAviso(null); }

  async function exportar() {
    if (!agente || busy) return;
    setBusy("exportar"); setErro(null);
    try {
      const nova = await request<{ id: string }>(rota(conversaId), {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: agente, profile_id: conta || null }),
      });
      if (abrir) { fechar(); abrir(nova.id); }
      else setAviso("Conversa nova aberta: está em CHATS, na lateral.");
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setBusy(null); }
  }

  async function copiar() {
    setBusy("copiar"); setErro(null);
    try {
      const { markdown } = await request<{ markdown: string }>(rota(conversaId));
      await navigator.clipboard.writeText(markdown);
      setAviso("Copiado: cole em qualquer agente, issue ou documento.");
    } catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
    finally { setBusy(null); }
  }

  const contas = catalogo?.profiles.filter((p) => p.provider === agente) ?? [];
  return (
    <>
      <button type="button" className="composer-botao" title="Exportar para outro agente" aria-label="Exportar para outro agente"
        onClick={() => setAberto(true)}>
        <SendIcon aria-hidden className="h-4 w-4" />
      </button>
      {aberto && (
        <Modal titulo="Exportar para outro agente" largura="sm" onFechar={fechar}>
          <div className="modal-secao">
            <ul className="modal-explica">
              <li>Vira um resumo em Markdown (objetivo, arquivos alterados, comandos e as últimas mensagens), sem chaves nem senhas.</li>
              <li>Uma conversa nova abre no agente escolhido, começando por esse resumo. Esta continua como está.</li>
            </ul>
            <label htmlFor="exportar-agente" className="modal-rotulo">Agente</label>
            <Select id="exportar-agente" value={agente} placeholder={catalogo ? "Escolha o agente…" : "Carregando…"}
              options={(catalogo?.agents ?? []).map((a) => ({ value: a.id, label: a.label, icon: <AgentIcon provider={a.id} size={14} className="shrink-0" /> }))}
              onChange={(valor) => { setAgente(valor); setConta(""); }} />
            {contas.length > 1 && <>
              <label htmlFor="exportar-conta" className="modal-rotulo">Conta</label>
              <Select id="exportar-conta" value={conta}
                options={[{ value: "", label: "Padrão" }, ...contas.map((p) => ({ value: p.id, label: p.name }))]}
                onChange={setConta} />
            </>}
            {aviso && <p role="status" className="text-xs text-success">{aviso}</p>}
            {erro && <p role="alert" className="text-xs text-danger">{erro}</p>}
            <div className="modal-acoes">
              <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void copiar()}>
                <CopyIcon aria-hidden className="h-3.5 w-3.5" />{busy === "copiar" ? "Copiando…" : "Copiar como Markdown"}
              </Button>
              <Button size="sm" variant="primary" disabled={busy !== null || !agente} onClick={() => void exportar()}>
                {busy === "exportar" ? "Abrindo…" : "Exportar"}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
