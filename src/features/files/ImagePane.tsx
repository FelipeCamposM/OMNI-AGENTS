import { convertFileSrc } from "@tauri-apps/api/core";
import type { WorkspaceTab } from "../../types/workspace";

interface ImagePaneProps {
  tab: WorkspaceTab;
}

/** Só visualização — imagem não é editável, então não passa pelo Monaco (que além do
 * mais tentaria ler o binário como texto e mostraria lixo). */
export function ImagePane({ tab }: ImagePaneProps) {
  const path = tab.resourceId ?? "";
  return (
    <div className="h-full w-full flex items-center justify-center overflow-auto bg-[#0e0e14] p-4">
      <img src={convertFileSrc(path)} alt={tab.title} className="max-w-full max-h-full object-contain" />
    </div>
  );
}
