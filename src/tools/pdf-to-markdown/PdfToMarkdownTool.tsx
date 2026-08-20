import { useReducer, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { appReducer, INITIAL_STATE } from "../../types/conversion";
import type { FileItem, ConversionResult, SelectedFile } from "../../types/conversion";
import { useConversion } from "../../hooks/useConversion";
import { DropZone } from "../../components/DropZone";
import { FileQueue } from "../../components/FileQueue";
import { MarkdownViewer } from "../../components/MarkdownViewer";
import { ActionBar } from "../../components/ActionBar";
import type { ToolProps } from "../registry";
import { useToolEnter } from "../../lib/motion";
import { Button } from "../../components/ui";


export function PdfToMarkdownTool({ settings, addHistory }: ToolProps) {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);

  const handleComplete = useCallback(
    (fileItem: FileItem, result: ConversionResult) => {
      addHistory({
        id: crypto.randomUUID(),
        tool: "pdf-to-markdown",
        filename: fileItem.file.name,
        inputPath: fileItem.file.path,
        outputPath: result.success ? result.outputPath : undefined,
        durationMs: result.success ? result.durationMs : 0,
        timestamp: Date.now(),
        success: result.success,
        markdown: result.success ? result.markdown : "",
      });
    },
    [addHistory]
  );

  const { convertFile, saveFile, openContainingFolder } = useConversion(
    dispatch,
    handleComplete
  );

  function computeOutputPath(file: SelectedFile): string | undefined {
    if (settings.autoSaveNextToPdf) {
      const name = file.name.replace(/\.pdf$/i, ".md");
      const dir = file.path.replace(/[/\\][^/\\]+$/, "");
      return `${dir}\\${name}`;
    }
    if (settings.defaultOutputDir) {
      const name = file.name.replace(/\.pdf$/i, ".md");
      return `${settings.defaultOutputDir}\\${name}`;
    }
    return undefined;
  }

  function handleAddFiles(files: SelectedFile[]) {
    const newItems: FileItem[] = files.map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      status: "pending",
      progressStep: 0,
    }));
    dispatch({ type: "ADD_FILES", files: newItems });
    if (!state.activeFileId && newItems.length > 0) {
      dispatch({ type: "SET_ACTIVE_FILE", id: newItems[0].id });
    }
  }

  async function handleConvertFile(id: string) {
    const item = state.files.find((f) => f.id === id);
    if (!item || item.status !== "pending") return;
    await convertFile(item, computeOutputPath(item.file));
  }

  async function handleConvertAll() {
    const pending = state.files.filter((f) => f.status === "pending");
    for (const item of pending) {
      await convertFile(item, computeOutputPath(item.file));
    }
  }

  async function handleSave() {
    const active = activeFile;
    if (!active || active.status !== "success" || !active.markdown) return;

    const suggestedName = active.file.name.replace(/\.pdf$/i, ".md");
    const savePath = await save({
      filters: [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: settings.defaultOutputDir
        ? `${settings.defaultOutputDir}\\${suggestedName}`
        : suggestedName,
    });

    if (savePath) {
      await saveFile(active.id, savePath, active.markdown);
      if (settings.openFolderAfterSave) {
        await openContainingFolder(savePath);
      }
    }
  }


  function handleClearDone() {
    const done = state.files.filter(
      (f) => f.status === "success" || f.status === "error"
    );
    for (const f of done) {
      dispatch({ type: "REMOVE_FILE", id: f.id });
    }
  }

  const isConverting = state.files.some((f) => f.status === "converting");
  const activeFile = state.files.find((f) => f.id === state.activeFileId) ?? null;


  const toolRef = useToolEnter();

  return (
    <div ref={toolRef} className="space-y-5">
      {state.files.length === 0 ? (
        <DropZone onFiles={handleAddFiles} disabled={isConverting} maxSizeMb={settings.maxFileSizeMb} />
      ) : (
        <DropZone onFiles={handleAddFiles} disabled={isConverting} maxSizeMb={settings.maxFileSizeMb} compact />
      )}

      {state.files.length > 0 && (
        <FileQueue
          files={state.files}
          activeFileId={state.activeFileId}
          isConverting={isConverting}
          onSelectFile={(id) => dispatch({ type: "SET_ACTIVE_FILE", id })}
          onRemoveFile={(id) => dispatch({ type: "REMOVE_FILE", id })}
          onConvertFile={handleConvertFile}
          onConvertAll={handleConvertAll}
          onClearDone={handleClearDone}
        />
      )}

      {activeFile?.status === "success" && activeFile.markdown && (
        <>
          <div className="flex items-center gap-2">
            <p className="text-text-primary text-sm font-medium flex-1 truncate">
              {activeFile.file.name}
            </p>
            <span className="text-success text-xs font-medium bg-success/10 border border-success/40 px-2 py-0.5 rounded-full">
              Convertido
            </span>
          </div>

          <MarkdownViewer
            content={activeFile.markdown}
            onChange={(md) =>
              dispatch({
                type: "UPDATE_FILE",
                id: activeFile.id,
                updates: { markdown: md },
              })
            }
            onCopy={() => {}}
            onClear={() => dispatch({ type: "REMOVE_FILE", id: activeFile.id })}
          />

          <ActionBar
            savedPath={activeFile.savedPath ?? null}
            durationMs={activeFile.durationMs ?? 0}
            onSave={handleSave}
            onReset={() => dispatch({ type: "REMOVE_FILE", id: activeFile.id })}
          />
        </>
      )}

      {activeFile?.status === "error" && (
        <div className="rounded-xl border border-danger/40 bg-danger/10 px-4 py-4 space-y-1">
          <p className="text-danger text-sm font-medium">Erro na conversão</p>
          <p className="text-text-muted text-xs">{activeFile.errorMessage}</p>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => {
              dispatch({
                type: "UPDATE_FILE",
                id: activeFile.id,
                updates: { status: "pending", errorMessage: undefined, errorCode: undefined },
              });
            }}
          >
            Tentar novamente
          </Button>
        </div>
      )}

      {state.files.length === 0 && (
        <p className="text-text-muted text-xs text-center">
          Todo o processamento ocorre localmente. Nenhum arquivo é enviado para a internet.
        </p>
      )}
    </div>
  );
}
