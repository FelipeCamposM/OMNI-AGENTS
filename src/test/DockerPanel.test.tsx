import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DockerPanel } from "../components/DockerPanel";
import type { DockerContainer } from "../features/docker/dockerService";

vi.mock("../features/docker/dockerService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/docker/dockerService")>()),
  dockerContainers: vi.fn(),
  dockerContainerAction: vi.fn(),
}));

const { dockerContainers, dockerContainerAction } = vi.mocked(await import("../features/docker/dockerService"));

const container = (overrides: Partial<DockerContainer>): DockerContainer => ({
  id: "id",
  name: "c",
  image: "img",
  state: "running",
  status: "Up",
  ports: "",
  compose_project: "",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  dockerContainers.mockResolvedValue([
    container({ id: "1", name: "web-1", compose_project: "loja" }),
    container({ id: "2", name: "redis", state: "exited" }),
  ]);
  dockerContainerAction.mockResolvedValue(undefined);
});

describe("DockerPanel", () => {
  it("agrupa pelo Compose e para/inicia conforme o estado", async () => {
    render(<DockerPanel onRunInTerminal={vi.fn()} />);
    expect(await screen.findByText("loja")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Parar web-1" }));
    expect(dockerContainerAction).toHaveBeenCalledWith("1", "stop");

    await userEvent.click(screen.getByRole("button", { name: "Iniciar redis" }));
    expect(dockerContainerAction).toHaveBeenCalledWith("2", "start");
  });

  it("remove só depois de confirmar e abre logs no terminal", async () => {
    const onRunInTerminal = vi.fn();
    render(<DockerPanel onRunInTerminal={onRunInTerminal} />);

    await userEvent.click(await screen.findByRole("button", { name: "Remover redis" }));
    expect(dockerContainerAction).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sim" }));
    await waitFor(() => expect(dockerContainerAction).toHaveBeenCalledWith("2", "remove"));

    await userEvent.click(screen.getByRole("button", { name: "Ver logs de web-1" }));
    expect(onRunInTerminal).toHaveBeenCalledWith("logs · web-1", "docker logs -f --tail 200 web-1");
  });

  it("mostra o erro do docker quando o daemon não responde", async () => {
    dockerContainers.mockRejectedValue(new Error("Docker não encontrado no PATH."));
    render(<DockerPanel onRunInTerminal={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Docker não encontrado");
  });
});
