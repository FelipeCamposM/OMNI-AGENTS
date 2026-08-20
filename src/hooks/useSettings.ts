import { useState, useCallback, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AppSettings } from "../types/settings";
import { DEFAULT_SETTINGS } from "../types/settings";
import { loadSettings, saveSettings } from "../services/settingsService";
import { setMotionLevel } from "../lib/motion";
import { coresDaPaleta, hexParaRgbCss } from "../lib/palettes";
import { isBackgroundEffect } from "../components/backgrounds/registry";

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());

  // Fora de effect de propósito: os hooks de GSAP dos filhos rodam logo após
  // este render e precisam do nível já atualizado.
  setMotionLevel(settings.animations);

  const updateSettings = useCallback((updates: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...updates };
      saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    setSettings({ ...DEFAULT_SETTINGS });
    saveSettings({ ...DEFAULT_SETTINGS });
  }, []);

  // Tema + paleta de cor. Andam juntos de propósito: a paleta tem variante
  // para o tema claro, então quem resolve "sistema → claro/escuro" é também
  // quem sabe qual variante escrever. Separar em dois efeitos deixaria a cor
  // um render atrás do tema ao seguir o Windows.
  useEffect(() => {
    const root = document.documentElement;

    const aplicar = (claro: boolean) => {
      root.dataset.theme = claro ? "claro" : "escuro";
      const { base, deep } = coresDaPaleta(settings.accent, claro);
      // Sobrescreve as vars do index.css no próprio <html>. Inline e não uma
      // regra `[data-accent]` no CSS porque a tabela de paletas já precisa
      // existir em TS para alimentar os efeitos em WebGL — duplicá-la no CSS
      // é convite para as duas divergirem.
      root.style.setProperty("--c-accent", hexParaRgbCss(base));
      root.style.setProperty("--c-accent-hover", hexParaRgbCss(deep));
      root.style.setProperty("--c-selected", hexParaRgbCss(base));
      root.style.setProperty("--c-selected-deep", hexParaRgbCss(deep));
    };

    if (settings.theme !== "sistema") {
      aplicar(settings.theme === "claro");
      return;
    }
    const media = window.matchMedia?.("(prefers-color-scheme: light)");
    const seguirSistema = () => aplicar(!!media?.matches);
    seguirSistema();
    media?.addEventListener("change", seguirSistema);
    return () => media?.removeEventListener("change", seguirSistema);
  }, [settings.theme, settings.accent]);

  // Aparência: fundo, intensidade do vidro e movimento (ver index.css).
  useEffect(() => {
    const root = document.documentElement;
    // Efeitos animados são desenhados pelo <AppBackground>, não pelo CSS —
    // um data-bg genérico desliga as camadas do body (ver index.css).
    root.dataset.bg = isBackgroundEffect(settings.background) ? "efeito" : settings.background;
    root.dataset.glass = settings.glass;
    root.dataset.motion = settings.animations;
    root.style.setProperty("--app-bg-opacity", String(settings.backgroundOpacity / 100));
    root.style.setProperty("--app-bg-blur", `${settings.backgroundBlur}px`);

    if (settings.background === "custom" && settings.backgroundPath) {
      // Aspas simples na url() evitam quebrar o valor com caminhos que tenham ".
      const src = convertFileSrc(settings.backgroundPath).replace(/'/g, "%27");
      root.style.setProperty("--app-bg-image", `url('${src}')`);
    } else {
      // Deixa o preset de [data-bg] no index.css valer.
      root.style.removeProperty("--app-bg-image");
    }
  }, [
    settings.background,
    settings.backgroundPath,
    settings.backgroundOpacity,
    settings.backgroundBlur,
    settings.glass,
    settings.animations,
  ]);

  return { settings, updateSettings, resetSettings };
}
