// Topo das telas de Estudos (no padrão das páginas do app: selo, título pixel, abas com ícone).
import type { ComponentType, ReactNode, SVGProps } from "react";
import { ChartBarIcon, CloseIcon, CompassIcon, HourglassIcon, MapIcon } from "../../components/ui/PixelIcon";
import "./estudos.css";

export type SecaoDeEstudo = "roadmaps" | "mentor" | "pomodoro" | "analises";

type Icone = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

export const SECOES: { valor: SecaoDeEstudo; rotulo: string; titulo: string; descricao: string; Icone: Icone }[] = [
  { valor: "roadmaps", rotulo: "Roadmaps", titulo: "Roadmaps de estudo", descricao: "Caminhos de etapas diárias com aula, tarefas, cards e caderno. Continue de onde parou enquanto os agentes trabalham.", Icone: MapIcon },
  { valor: "mentor", rotulo: "Mentor", titulo: "Mentor de estudo", descricao: "Conte o que está fazendo: ele registra a atividade e diz o próximo passo, com tempo, quantidade e plataforma.", Icone: CompassIcon },
  { valor: "pomodoro", rotulo: "Pomodoro", titulo: "Pomodoro", descricao: "Blocos de foco por matéria, com pausas e histórico. Fica igual no PC e no celular.", Icone: HourglassIcon },
  { valor: "analises", rotulo: "Análises", titulo: "Análises de estudo", descricao: "Foco, questões, etapas e revisões por dia, semana e matéria.", Icone: ChartBarIcon },
];

export function AbasDosEstudos({ secao, onSecao }: { secao: SecaoDeEstudo; onSecao: (s: SecaoDeEstudo) => void }) {
  return (
    <nav className="es-abas" aria-label="Seções de estudo">
      {SECOES.map(({ valor, rotulo, Icone }) => (
        <button key={valor} type="button" className="es-aba" aria-pressed={valor === secao} onClick={() => onSecao(valor)}>
          <Icone size={16} aria-hidden="true" />{rotulo}
        </button>
      ))}
    </nav>
  );
}

export function CabecalhoDosEstudos({ secao, onSecao, onFechar, children }: { secao: SecaoDeEstudo; onSecao: (s: SecaoDeEstudo) => void; onFechar?: () => void; children?: ReactNode }) {
  const atual = SECOES.find((s) => s.valor === secao) ?? SECOES[0];
  return (
    <div className="es-topo-caixa">
      <header className="es-topo">
        <span className="es-selo" aria-hidden="true"><atual.Icone size={24} /></span>
        <div className="es-titulo">
          <h1 className="pixel-text">{atual.titulo}</h1>
          <p>{atual.descricao}</p>
        </div>
        {children}
        {onFechar && <button type="button" className="es-fechar" onClick={onFechar} aria-label="Fechar estudos"><CloseIcon size={14} aria-hidden="true" /></button>}
      </header>
      <AbasDosEstudos secao={secao} onSecao={onSecao} />
    </div>
  );
}
