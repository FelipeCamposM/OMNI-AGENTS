import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { invoke } from "@tauri-apps/api/core";
import { usarAbrirArquivo, usarBuscadorDeIcone, usarTransporte } from "./mobile/api";
import { EVENTO_ABRIR_ARQUIVO } from "./mobile/anexos";
import { transporteDoEngine } from "./features/conversa/transporteDoEngine";

// A visão Conversa das abas de agente usa o chat da web; aqui ele fala com o engine pelo protocolo
// local em vez de HTTP.
usarTransporte(transporteDoEngine);
// E no PC o arquivo citado pelo agente abre num painel (o `App` escuta o evento).
// O `App` responde: abriu ou o motivo de não abrir (arquivo que não existe).
usarAbrirArquivo((caminho) => new Promise<void>((ok, falha) => {
  window.dispatchEvent(new CustomEvent(EVENTO_ABRIR_ARQUIVO, { detail: { caminho, ok, falha } }));
}));

// Ícone da ferramenta chamada na conversa: o PC busca na rede e salva para a web/celular também.
usarBuscadorDeIcone(async (chave) => (await invoke<string | null>("icone_da_ferramenta", { chave })) ?? null);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
