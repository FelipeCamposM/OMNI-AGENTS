import { describe, expect, it } from "vitest";
import {
  exhaustedUntilMs,
  selectFailoverProfile,
  type AgentCliId,
  type Profile,
  usageLimitResetAtMs,
} from "../features/terminal/terminalService";

function profile(id: string, provider: AgentCliId, authenticated = true): Profile {
  return {
    id,
    provider,
    name: id,
    config_dir: `C:/profiles/${provider}/${id}`,
    builtin: id.endsWith("padrao"),
    created_at_ms: 0,
    last_used_at_ms: null,
    authenticated,
  };
}

describe("seleção da conta de failover", () => {
  it.each(["claude", "codex"] as const)(
    "escolhe outra conta autenticada de %s e não volta para uma já esgotada",
    (provider) => {
      const profiles = [
        profile(`${provider}-padrao`, provider),
        profile(`${provider}-sem-login`, provider, false),
        profile(`${provider}-trabalho`, provider),
        profile("conta-de-outro-provider", provider === "claude" ? "codex" : "claude"),
      ];

      expect(
        selectFailoverProfile(profiles, provider, `${provider}-padrao`, [`${provider}-padrao`])?.id
      ).toBe(`${provider}-trabalho`);
      expect(
        selectFailoverProfile(
          profiles,
          provider,
          `${provider}-trabalho`,
          [`${provider}-padrao`, `${provider}-trabalho`]
        )
      ).toBeNull();
    }
  );

  it("mantém a conta bloqueada até o último reset que ainda está em 100%", () => {
    const now = 2_000_000_000_000;
    const usage = {
      status: "available",
      observed_at_ms: now,
      primary: { used_percent: 100, resets_at: now / 1000 + 300, reset_label: null },
      secondary: { used_percent: 100, resets_at: now / 1000 + 3_600, reset_label: null },
      reason: null,
    };

    expect(exhaustedUntilMs(usage, now)).toBe(now + 3_600_000);
    expect(exhaustedUntilMs(usage, now + 3_600_001)).toBeNull();
  });

  it("usa o reset da janela mais consumida quando a mensagem de limite chega antes de 100%", () => {
    const now = 2_000_000_000_000;
    const usage = {
      status: "available",
      observed_at_ms: now,
      primary: { used_percent: 82, resets_at: now / 1000 + 300, reset_label: null },
      secondary: { used_percent: 96, resets_at: now / 1000 + 3_600, reset_label: null },
      reason: null,
    };

    expect(usageLimitResetAtMs(usage, now)).toBe(now + 3_600_000);
    expect(usageLimitResetAtMs(null, now)).toBe(now + 5 * 60 * 60 * 1000);
  });
});
