import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FieldSize } from "./Input";

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  /** Linha secundária dentro da opção (peso do modelo, explicação curta). */
  hint?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string | number> {
  id?: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  size?: FieldSize;
  disabled?: boolean;
  className?: string;
  /** Texto quando `value` não casa com nenhuma opção. */
  placeholder?: string;
  /** Campo de busca no topo da lista. Ligue quando passar de ~15 opções. */
  searchable?: boolean;
  /** Texto do campo de busca. */
  searchPlaceholder?: string;
}

const SIZE: Record<FieldSize, string> = {
  sm: "px-2.5 py-1.5 text-xs",
  md: "px-3 py-2 text-sm",
};

/**
 * Select próprio, não `<select>` nativo.
 *
 * O motivo é simples: a lista de um `<select>` é desenhada pelo **sistema
 * operacional**, não pelo WebView. Nenhuma regra de CSS alcança ela — no
 * Windows sai um menu branco quadrado, ignorando tema, vidro e o roxo do app.
 * A única forma de padronizar é desenhar a lista em HTML.
 *
 * O que isso obriga a reimplementar (e está aqui): papéis ARIA de
 * combobox/listbox, navegação por teclado, fechar no Esc e no clique fora.
 */
export function Select<T extends string | number>({
  id,
  value,
  options,
  onChange,
  size = "md",
  disabled,
  className,
  placeholder = "Selecione…",
  searchable = false,
  searchPlaceholder = "Pesquisar…",
}: SelectProps<T>) {
  const [aberto, setAberto] = useState(false);
  const [ativo, setAtivo] = useState(0);
  const [busca, setBusca] = useState("");
  const [paraCima, setParaCima] = useState(false);
  const raizRef = useRef<HTMLDivElement>(null);
  const listaRef = useRef<HTMLUListElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);
  const autoId = useId();
  const listaId = `${id ?? autoId}-lista`;

  const selecionado = options.find((o) => o.value === value);

  // Casa sem acento: "voce" acha "Você". Nome de fonte quase sempre é ASCII,
  // mas o Select é genérico e o custo é uma linha.
  const visiveis = useMemo(() => {
    const termo = busca.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    if (!searchable || !termo) return options;
    return options.filter((o) =>
      `${o.label} ${o.hint ?? ""}`
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLowerCase()
        .includes(termo)
    );
  }, [options, busca, searchable]);

  const selecionadoIdx = visiveis.findIndex((o) => o.value === value);

  // Fecha ao clicar fora. Sem isto o popover fica preso quando o usuário já
  // seguiu para outra coisa.
  useEffect(() => {
    if (!aberto) return;
    function onDown(e: PointerEvent) {
      if (!raizRef.current?.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [aberto]);

  // Abre para cima quando não cabe embaixo — a lista tem até 240px e vários
  // selects ficam na metade de baixo da página.
  useLayoutEffect(() => {
    if (!aberto) {
      // Zera a busca ao fechar: reabrir com o filtro de antes escondendo a
      // opção marcada dá a impressão de que a lista encolheu sozinha.
      setBusca("");
      return;
    }
    const r = raizRef.current?.getBoundingClientRect();
    if (r) setParaCima(window.innerHeight - r.bottom < 260 && r.top > 260);
    setAtivo(selecionadoIdx >= 0 ? selecionadoIdx : 0);
    buscaRef.current?.focus();
    // `selecionadoIdx` de propósito fora das deps: ele muda a cada tecla
    // digitada (a lista filtra), e reposicionar o ativo aí atrapalharia a
    // navegação por seta durante a busca.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Digitar refaz a lista: o ativo tem de voltar para o topo, senão aponta
  // para um índice que já não existe.
  useEffect(() => {
    setAtivo(0);
  }, [busca]);

  // Mantém a opção ativa visível durante a navegação por teclado.
  // `?.()` na chamada: `scrollIntoView` não existe no jsdom, e um TypeError
  // aqui derruba o componente inteiro por causa de um detalhe cosmético.
  useEffect(() => {
    if (!aberto) return;
    listaRef.current?.children[ativo]?.scrollIntoView?.({ block: "nearest" });
  }, [aberto, ativo]);

  function proximoHabilitado(de: number, passo: number) {
    if (visiveis.length === 0) return de;
    for (let i = 1; i <= visiveis.length; i++) {
      const idx = (de + passo * i + visiveis.length * 2) % visiveis.length;
      if (!visiveis[idx].disabled) return idx;
    }
    return de;
  }

  function escolher(idx: number) {
    const o = visiveis[idx];
    if (!o || o.disabled) return;
    onChange(o.value);
    setAberto(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (disabled) return;

    if (!aberto) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        setAberto(true);
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setAberto(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setAtivo((i) => proximoHabilitado(i, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setAtivo((i) => proximoHabilitado(i, -1));
        break;
      case "Home":
        e.preventDefault();
        setAtivo(proximoHabilitado(visiveis.length - 1, 1));
        break;
      case "End":
        e.preventDefault();
        setAtivo(proximoHabilitado(0, -1));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        escolher(ativo);
        break;
      case "Tab":
        setAberto(false);
        break;
    }
  }

  return (
    <div ref={raizRef} className={["relative", className].filter(Boolean).join(" ")}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-expanded={aberto}
        aria-haspopup="listbox"
        aria-controls={aberto ? listaId : undefined}
        aria-activedescendant={aberto ? `${listaId}-${ativo}` : undefined}
        disabled={disabled}
        onClick={() => setAberto((v) => !v)}
        onKeyDown={onKeyDown}
        className={[
          "field flex items-center justify-between gap-2 text-left",
          SIZE[size],
          aberto ? "select-aberto" : "",
        ].join(" ")}
      >
        <span className={selecionado ? "truncate" : "truncate text-text-muted"}>
          {selecionado?.label ?? placeholder}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={[
            "w-4 h-4 shrink-0 text-text-muted transition-transform",
            aberto ? "rotate-180" : "",
          ].join(" ")}
        />
      </button>

      {aberto && (
        <div
          className={[
            "popover absolute left-0 right-0 z-50 p-1",
            paraCima ? "bottom-full mb-1" : "top-full mt-1",
          ].join(" ")}
        >
          {searchable && (
            <div className="relative mb-1">
              <Search
                aria-hidden="true"
                className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted"
              />
              <input
                ref={buscaRef}
                type="text"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                aria-label={searchPlaceholder}
                aria-controls={listaId}
                className="field !py-1.5 !pl-7 !pr-2 text-xs"
              />
            </div>
          )}

          {visiveis.length === 0 && (
            <p className="text-text-muted text-xs px-2.5 py-3 text-center">
              Nada encontrado para “{busca.trim()}”.
            </p>
          )}

          <ul
            ref={listaRef}
            id={listaId}
            role="listbox"
            aria-label="Opções"
            className="max-h-56 overflow-y-auto"
          >
            {visiveis.map((o, i) => {
            const marcado = o.value === value;
            return (
              <li
                key={String(o.value)}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={marcado}
                aria-disabled={o.disabled || undefined}
                onPointerEnter={() => !o.disabled && setAtivo(i)}
                onClick={() => escolher(i)}
                className={[
                  "flex items-start gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors",
                  o.disabled ? "opacity-50 cursor-not-allowed" : "",
                  i === ativo && !o.disabled ? "bg-selected/20" : "",
                  marcado ? "text-text-primary" : "text-text-secondary",
                ].join(" ")}
              >
                <Check
                  aria-hidden="true"
                  strokeWidth={3}
                  className={[
                    "w-3.5 h-3.5 mt-0.5 shrink-0 text-selected",
                    marcado ? "" : "invisible",
                  ].join(" ")}
                />
                <span className="min-w-0">
                  <span className="block text-xs leading-snug">{o.label}</span>
                  {o.hint && (
                    <span className="block text-text-muted text-[10px] leading-snug">{o.hint}</span>
                  )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
