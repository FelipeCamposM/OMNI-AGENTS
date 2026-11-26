import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`, invoke: vi.fn() }));
vi.mock("../features/files/FilePane", () => ({ FilePane: () => <div>editor</div> }));
vi.mock("../features/files/filesService", () => ({ fileMtime: vi.fn().mockResolvedValue(1) }));
import { HtmlPane } from "../features/files/HtmlPane";

describe("HtmlPane", () => {
  it("mostra código e página; a página roda isolada do app", () => {
    render(<HtmlPane projectPath="C:/p" tab={{ id: "t", kind: "file", title: "index.html", resourceId: "C:/p/index.html" } as never}
      fileSaveMode="auto" onDirtyChange={() => undefined} />);
    const pagina = screen.getByTitle("Página: index.html");
    expect(pagina).toHaveAttribute("sandbox", expect.not.stringContaining("allow-same-origin"));
    expect(screen.getByText("editor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Código" }));
    expect(screen.queryByTitle("Página: index.html")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Página" }));
    expect(screen.queryByText("editor")).toBeNull();
  });
});
