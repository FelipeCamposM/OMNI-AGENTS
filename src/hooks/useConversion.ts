import { useCallback } from "react";
import type { AppAction, FileItem, ConversionResult } from "../types/conversion";
import { convertPdf, saveMarkdown, openFolder } from "../services/conversionService";

export const PROGRESS_STEPS = [
  "Preparando documento",
  "Analisando páginas",
  "Convertendo conteúdo",
  "Gerando Markdown",
];

const STEP_INTERVAL_MS = 3500;

export function useConversion(
  dispatch: React.Dispatch<AppAction>,
  onComplete: (fileItem: FileItem, result: ConversionResult) => void
) {
  const convertFile = useCallback(
    async (fileItem: FileItem, outputPath?: string) => {
      dispatch({
        type: "UPDATE_FILE",
        id: fileItem.id,
        updates: { status: "converting", progressStep: 0 },
      });
      dispatch({ type: "SET_ACTIVE_FILE", id: fileItem.id });

      let stepIndex = 0;
      const timer = setInterval(() => {
        stepIndex = Math.min(stepIndex + 1, PROGRESS_STEPS.length - 1);
        dispatch({
          type: "UPDATE_FILE",
          id: fileItem.id,
          updates: { progressStep: stepIndex },
        });
      }, STEP_INTERVAL_MS);

      try {
        const result = await convertPdf({
          inputPath: fileItem.file.path,
          outputPath,
        });
        clearInterval(timer);

        if (result.success) {
          dispatch({
            type: "UPDATE_FILE",
            id: fileItem.id,
            updates: {
              status: "success",
              markdown: result.markdown,
              durationMs: result.durationMs,
              savedPath: result.outputPath || null,
            },
          });
        } else {
          dispatch({
            type: "UPDATE_FILE",
            id: fileItem.id,
            updates: {
              status: "error",
              errorMessage: result.message,
              errorCode: result.errorCode,
            },
          });
        }

        onComplete(fileItem, result);
      } catch (err) {
        clearInterval(timer);
        const errResult: ConversionResult = {
          success: false,
          errorCode: "UNKNOWN_ERROR",
          message: "Ocorreu um erro inesperado durante a conversão.",
        };
        dispatch({
          type: "UPDATE_FILE",
          id: fileItem.id,
          updates: {
            status: "error",
            errorMessage: errResult.message,
            errorCode: errResult.errorCode,
          },
        });
        onComplete(fileItem, errResult);
      }
    },
    [dispatch, onComplete]
  );

  const saveFile = useCallback(
    async (fileId: string, path: string, content: string) => {
      await saveMarkdown(path, content);
      dispatch({ type: "UPDATE_FILE", id: fileId, updates: { savedPath: path } });
    },
    [dispatch]
  );

  const openContainingFolder = useCallback(async (filePath: string) => {
    await openFolder(filePath);
  }, []);

  return { convertFile, saveFile, openContainingFolder, progressSteps: PROGRESS_STEPS };
}
