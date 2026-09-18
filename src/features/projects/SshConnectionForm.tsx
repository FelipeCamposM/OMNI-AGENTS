import { useState } from "react";
import { Button, Input } from "../../components/ui";
import {
  NOVA_CONEXAO,
  removeSshConnection,
  saveSshConnection,
  testSshConnection,
  type SshConnection,
} from "./sshService";

interface SshConnectionFormProps {
  connection: SshConnection | null;
  onSaved: (connection: SshConnection) => void;
  onCancel: () => void;
}

function texto(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason);
}

/** Cadastro de máquina remota. Sem campo de senha de propósito: o app não guarda credencial
 *  (spec §9.4), e o `ssh` roda em `BatchMode`, então a autenticação é por chave ou pelo agente. */
export function SshConnectionForm({ connection, onSaved, onCancel }: SshConnectionFormProps) {
  const [form, setForm] = useState<SshConnection>(connection ?? NOVA_CONEXAO);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  function campo<K extends keyof SshConnection>(chave: K, valor: SshConnection[K]) {
    setForm((atual) => ({ ...atual, [chave]: valor }));
  }

  async function correr(acao: () => Promise<void>) {
    setBusy(true);
    setErro(null);
    setOk(null);
    try {
      await acao();
    } catch (reason) {
      setErro(texto(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-2 border border-border-subtle p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void correr(async () => onSaved(await saveSshConnection(form)));
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <Campo label="Nome" value={form.name} onChange={(valor) => campo("name", valor)} placeholder="Servidor de dev" />
        <Campo label="Usuário" value={form.user} onChange={(valor) => campo("user", valor)} placeholder="ana" />
        <Campo label="Host" value={form.host} onChange={(valor) => campo("host", valor)} placeholder="10.0.0.5" />
        <Campo
          label="Porta"
          value={String(form.port)}
          onChange={(valor) => campo("port", Number(valor) || 22)}
          placeholder="22"
        />
        <Campo
          label="Pasta do projeto"
          value={form.remote_path}
          onChange={(valor) => campo("remote_path", valor)}
          placeholder="/srv/app"
        />
        <Campo label="Unidade" value={form.drive} onChange={(valor) => campo("drive", valor)} placeholder="X:" />
      </div>
      <Campo
        label="Chave privada (opcional)"
        value={form.key_path}
        onChange={(valor) => campo("key_path", valor)}
        placeholder="C:\\Users\\voce\\.ssh\\id_ed25519 — vazio usa o ssh-agent"
      />

      {erro && (
        <p role="alert" className="whitespace-pre-wrap border-l-2 border-danger pl-2 text-[11px] text-danger">
          {erro}
        </p>
      )}
      {ok && <p className="border-l-2 border-accent pl-2 text-[11px] text-text-secondary">{ok}</p>}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="submit" disabled={busy}>
          Salvar
        </Button>
        <Button
          size="sm"
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={() => void correr(async () => setOk(`Conectou: ${await testSshConnection(form)}`))}
        >
          Testar conexão
        </Button>
        {form.id && (
          <Button
            size="sm"
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void correr(async () => {
                await removeSshConnection(form.id);
                onCancel();
              })
            }
          >
            Remover
          </Button>
        )}
        <Button size="sm" type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

function Campo({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (valor: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-[10px] uppercase tracking-wider text-text-muted">
      {label}
      <Input
        size="sm"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 w-full normal-case"
      />
    </label>
  );
}
