import { Image } from "@tauri-apps/api/image";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LADO_DA_LOGO, svgDaLogo, type CamadaDaLogo } from "../components/ui/OmniLogo";

/**
 * Lado do bitmap do ícone, em pixels. Múltiplo inteiro do `viewBox` (63 × 4) para cada pixel da
 * arte virar um quadrado exato — num múltiplo quebrado o contorno sai com linhas de espessura
 * diferente. 252 já cobre o maior tamanho que o Windows pede da janela.
 */
const LADO = LADO_DA_LOGO * 4;

/** Guarda a última paleta desenhada: o efeito de tema roda em toda troca de configuração, e
 *  redesenhar o mesmo ícone faria o Windows piscar a barra de tarefas à toa. */
let ultimaAssinatura: string | null = null;

async function rasterizar(markup: string): Promise<ImageData> {
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  const imagem = new window.Image();
  imagem.width = LADO;
  imagem.height = LADO;
  imagem.src = url;
  await imagem.decode();

  const canvas = document.createElement("canvas");
  canvas.width = LADO;
  canvas.height = LADO;
  const contexto = canvas.getContext("2d");
  if (!contexto) throw new Error("Canvas 2D indisponível");
  contexto.imageSmoothingEnabled = false;
  contexto.drawImage(imagem, 0, 0, LADO, LADO);
  return contexto.getImageData(0, 0, LADO, LADO);
}

/**
 * Repinta o ícone da janela (e, com ele, o da barra de tarefas) com as cores da paleta em uso.
 *
 * Vai por RGBA cru de propósito: `Image.new` não precisa da feature `image-png` no lado Rust, que
 * seria o custo de mandar um PNG codificado.
 *
 * O que **não** muda é o ícone do atalho fixado e o do instalador — esses são o `.ico` gravado no
 * executável, e trocá-los exigiria reinstalar. Silencia qualquer falha: fora do Tauri (`dev:vite`,
 * testes) não existe janela, e um ícone é enfeite, nunca motivo de erro na tela.
 */
export async function aplicarIconeDaJanela(cores: Record<CamadaDaLogo, string>): Promise<void> {
  const assinatura = Object.values(cores).join("|");
  if (assinatura === ultimaAssinatura) return;
  try {
    const pixels = await rasterizar(svgDaLogo(cores, LADO));
    // `getImageData` devolve `Uint8ClampedArray`; o `Image.new` só aceita `Uint8Array`. Mesma
    // memória, só outra visão — nenhuma cópia dos 254 KB de pixels acontece aqui.
    const rgba = new Uint8Array(pixels.data.buffer, pixels.data.byteOffset, pixels.data.byteLength);
    const icone = await Image.new(rgba, LADO, LADO);
    await getCurrentWindow().setIcon(icone);
    ultimaAssinatura = assinatura;
  } catch {
    // Sem janela nativa, sem canvas, ou permissão negada: a logo na barra lateral já mostra a cor.
  }
}
