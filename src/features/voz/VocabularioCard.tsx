import { useEffect, useState } from "react";
import { Button, Card, Input } from "../../components/ui";
import { CloseIcon, FolderIcon, MicIcon, TrashIcon } from "../../components/ui/PixelIcon";
import { Titulo } from "../relatorios/RelatoriosIa";
import { lerVocabulario, salvarVocabulario, type Palavra, type Vocabulario } from "../../mobile/voz";
import "./vocabulario.css";

/**
 * Configurações → Geral → Vocabulário da voz. As palavras que a voz erra (escritas aqui ou aprendidas
 * quando a pessoa corrige um ditado) e, à parte, os nomes que cada projeto já dá sozinho. Tudo vira
 * dica para o whisper e troca automática depois de ditar.
 */
export function VocabularioCard() {
  const [vocab, setVocab] = useState<Vocabulario | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [termo, setTermo] = useState("");
  const [ouvido, setOuvido] = useState("");

  useEffect(() => {
    lerVocabulario().then(setVocab).catch((motivo) => setErro(motivo instanceof Error ? motivo.message : String(motivo)));
  }, []);

  async function salvar(itens: Palavra[]) {
    setErro(null);
    try { setVocab(await salvarVocabulario(itens)); }
    catch (motivo) { setErro(motivo instanceof Error ? motivo.message : String(motivo)); }
  }

  function adicionar() {
    if (!vocab || !termo.trim()) return;
    void salvar([...vocab.itens, { termo: termo.trim(), ouvido: ouvido.trim() ? [ouvido.trim()] : [], origem: "manual" }]);
    setTermo(""); setOuvido("");
  }

  const itens = vocab?.itens ?? [];
  const projetos = (vocab?.projetos ?? []).filter((p) => p.termos.length > 0);
  return (
    <Card title={<Titulo icone={MicIcon}>Vocabulário da voz</Titulo>} className="settings-largo">
      <p className="text-[11px] text-text-muted">
        Nomes que a voz não conhece. Depois de ditar, o que ela entendeu errado vira o termo certo, e o reconhecimento passa a
        esperar essas palavras. Quando você corrige um ditado no campo, a conversa pergunta se a correção entra aqui.
      </p>

      <form className="voc-nova" onSubmit={(event) => { event.preventDefault(); adicionar(); }}>
        <Input value={termo} placeholder="Palavra certa (ex.: SIAPLUS)" aria-label="Palavra certa" onChange={(event) => setTermo(event.target.value)} />
        <Input value={ouvido} placeholder="Como a voz entende (opcional)" aria-label="Como a voz entende" onChange={(event) => setOuvido(event.target.value)} />
        <Button type="submit" size="sm" disabled={!vocab || !termo.trim()}>Adicionar</Button>
      </form>

      {vocab && itens.length === 0 && <p className="text-xs text-text-muted">Nenhuma palavra ainda.</p>}
      {itens.length > 0 && (
        <ul className="voc-lista" aria-label="Suas palavras">
          {itens.map((item, i) => (
            <li key={item.termo} className="voc-item">
              <span className="voc-termo">{item.termo}</span>
              {item.origem === "correcao" && <span className="voc-selo">aprendida</span>}
              <span className="voc-ouvidos">
                {item.ouvido.map((forma) => (
                  <span key={forma} className="voc-ouvido">
                    {forma}
                    <button type="button" aria-label={`Esquecer "${forma}"`} title="Esquecer esta forma"
                      onClick={() => void salvar(itens.map((x, j) => (j === i ? { ...x, ouvido: x.ouvido.filter((o) => o !== forma) } : x)))}>
                      <CloseIcon className="h-2.5 w-2.5" aria-hidden />
                    </button>
                  </span>
                ))}
              </span>
              <button type="button" className="voc-remover" aria-label={`Remover ${item.termo}`} title="Remover a palavra"
                onClick={() => void salvar(itens.filter((_, j) => j !== i))}>
                <TrashIcon className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {projetos.length > 0 && (
        <div className="voc-projetos">
          <p className="text-[11px] uppercase tracking-wider text-text-muted">Dos projetos · automático</p>
          {projetos.map((projeto) => (
            <div key={projeto.nome} className="voc-projeto">
              <span className="voc-projeto-nome"><FolderIcon className="h-3 w-3" aria-hidden />{projeto.nome}</span>
              {projeto.termos.map((t) => <span key={t} className="voc-chip">{t}</span>)}
            </div>
          ))}
        </div>
      )}
      {erro && <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">{erro}</p>}
    </Card>
  );
}
