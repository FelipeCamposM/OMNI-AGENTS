import { useEffect, useReducer } from "react";
import { loadKanban, saveKanban } from "../../services/kanbanService";
import { kanbanReducer } from "./kanbanReducer";

export function useKanban() {
  const [kanban, dispatch] = useReducer(kanbanReducer, undefined, loadKanban);

  useEffect(() => {
    saveKanban(kanban);
  }, [kanban]);

  return { kanban, dispatch };
}
