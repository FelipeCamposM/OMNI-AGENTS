import { useCallback, useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { Button, Select } from "../../components/ui";
import { AgentIcon } from "../../components/ui/AgentIcon";
import { listProfiles, type Profile } from "../terminal/terminalService";
import {
  disabledSkillsDir,
  installSkill,
  listSkills,
  removeSkill,
  setSkillEnabled,
  skillScopes,
  skillsDir,
  type SkillInfo,
  type SkillScope,
} from "./skillsService";

function errorText(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

interface SkillsManagerProps {
  /** Projeto aberto, para o escopo `.claude/skills` dele. Sem projeto, só os escopos globais. */
  projectPath: string | null;
}

/**
 * Skills instaladas por conta (`<config da conta>/skills`) e no projeto aberto
 * (`.claude/skills`), com instalar, ativar/desativar e remover.
 *
 * Desativar **move** a pasta para `skills-disabled/` ao lado: o formato de skill não tem campo de
 * "desativada" e a CLI descobre skill varrendo `skills/`. Nada é reescrito — skill em link continua
 * link, e reativar é o movimento inverso.
 */
export function SkillsManager({ projectPath }: SkillsManagerProps) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [scopeId, setScopeId] = useState("");
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listProfiles()
      .then((list) => { if (!cancelled) setProfiles(list); })
      .catch((reason) => { if (!cancelled) setError(errorText(reason)); });
    return () => { cancelled = true; };
  }, []);

  const scopes = useMemo(() => skillScopes(profiles, projectPath), [profiles, projectPath]);
  const scope: SkillScope | null = scopes.find((item) => item.id === scopeId) ?? scopes[0] ?? null;

  const refresh = useCallback(async (target: SkillScope | null) => {
    if (!target) return;
    setSkills(null);
    try {
      setSkills(await listSkills(target));
    } catch (reason) {
      setSkills([]);
      setError(errorText(reason));
    }
  }, []);

  const scopeAtual = scope?.id ?? null;
  useEffect(() => {
    setError(null);
    setConfirmando(null);
    void refresh(scopes.find((item) => item.id === scopeAtual) ?? null);
  }, [scopeAtual, scopes, refresh]);

  /** Toda ação daqui mexe em disco; relê o escopo depois para a lista nunca mentir. */
  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await refresh(scope);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(null);
      setConfirmando(null);
    }
  }

  async function instalar(alvo: SkillScope) {
    const escolhida = await open({ directory: true, multiple: false, title: "Pasta da skill (com SKILL.md)" });
    if (typeof escolhida !== "string") return;
    await run("install", () => installSkill(alvo, escolhida));
  }

  const scopeOptions = scopes.map((item) => ({
    value: item.id,
    label: item.label,
    hint: item.kind === "project" ? "só deste projeto" : "todos os projetos desta conta",
    icon: <AgentIcon provider={item.provider} size={14} className="shrink-0" />,
  }));

  const ativas = skills?.filter((skill) => skill.enabled).length ?? 0;

  return (
    <section className="glass rounded-none p-5 space-y-4">
      <div>
        <h2 className="pixel-text text-text-primary text-sm">Skills</h2>
        <p className="mt-1 text-[11px] text-text-muted">
          Instruções que a CLI carrega sozinha quando a tarefa combina. Desativar move a pasta para
          <code className="mx-1 text-text-secondary">skills-disabled/</code>
          ao lado — nada é apagado e reativar traz de volta.
        </p>
      </div>

      {!scope ? (
        <p className="text-xs text-text-muted">
          Nenhuma conta de Claude ou Codex cadastrada. Adicione uma em Configurações → Agentes.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-[1_1_16rem]">
              <label htmlFor="skills-escopo" className="mb-1.5 block font-mono text-[10px] uppercase text-text-secondary">
                Escopo
              </label>
              <Select id="skills-escopo" size="sm" value={scope.id} options={scopeOptions} onChange={setScopeId} />
            </div>
            <Button size="sm" disabled={busy !== null} onClick={() => void instalar(scope)}>
              {busy === "install" ? "Instalando…" : "Instalar skill…"}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void refresh(scope)}>
              Atualizar
            </Button>
          </div>

          <p className="truncate text-[10px] text-text-muted" title={skillsDir(scope)}>
            {skillsDir(scope)}
          </p>

          {error && <p role="alert" className="border-l-2 border-danger pl-3 text-xs text-danger">{error}</p>}

          <div className="divide-y divide-border-subtle border-y border-border-subtle">
            {skills === null && <p className="py-4 text-xs text-text-muted">Lendo skills…</p>}
            {skills?.length === 0 && (
              <p className="py-4 text-xs text-text-muted">
                Nenhuma skill neste escopo. &ldquo;Instalar skill…&rdquo; copia uma pasta com SKILL.md para cá.
              </p>
            )}
            {skills?.map((skill) => (
              <div key={skill.path} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`h-2 w-2 shrink-0 ${skill.enabled ? "bg-success" : "bg-text-muted"}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-text-primary">
                    {skill.name}
                    {!skill.enabled && <span className="ml-2 text-[10px] text-text-muted">desativada</span>}
                    {skill.symlink && (
                      <span className="ml-2 text-[10px] text-text-muted" title="Instalada como link para outra pasta">
                        link
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[10px] text-text-muted" title={skill.description || skill.path}>
                    {skill.description || skill.id}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy !== null}
                  title="Abrir a pasta da skill no Explorer"
                  onClick={() => void revealItemInDir(skill.path).catch((reason) => setError(errorText(reason)))}
                >
                  Abrir pasta
                </Button>
                <Button
                  size="sm"
                  variant={skill.enabled ? "ghost" : "primary"}
                  disabled={busy !== null}
                  title={skill.enabled ? `Move para ${disabledSkillsDir(scope)}` : "Volta para a pasta de skills"}
                  onClick={() => void run(skill.path, () => setSkillEnabled(scope, skill, !skill.enabled))}
                >
                  {busy === skill.path ? "…" : skill.enabled ? "Desativar" : "Ativar"}
                </Button>
                {confirmando === skill.path ? (
                  <>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy !== null}
                      onClick={() => void run(skill.path, () => removeSkill(skill))}
                    >
                      Confirmar
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirmando(null)}>
                      Cancelar
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy !== null}
                    title={skill.symlink ? "Apaga só o link; a pasta original fica" : "Apaga a pasta da skill do disco"}
                    onClick={() => setConfirmando(skill.path)}
                  >
                    Remover
                  </Button>
                )}
              </div>
            ))}
          </div>

          {skills !== null && skills.length > 0 && (
            <p className="text-[10px] text-text-muted">
              {ativas} ativa{ativas === 1 ? "" : "s"} de {skills.length}.
            </p>
          )}
        </>
      )}
    </section>
  );
}
