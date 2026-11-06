import { useEffect } from "react";
import "@/styles/supervisorWorkspace.css";

/** Route-scoped tokens also reach portalled dialogs; never change the site theme. */
export function useSupervisorTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.dataset.workspace;
    root.dataset.workspace = "supervisor";
    return () => {
      if (previous === undefined) delete root.dataset.workspace;
      else root.dataset.workspace = previous;
    };
  }, []);
}
