import { useEffect } from "react";
import { installUnsavedWorkBeforeUnloadGuard } from "@/lib/unsavedWork";

export default function UnsavedWorkGuard() {
  useEffect(() => {
    installUnsavedWorkBeforeUnloadGuard();
  }, []);
  return null;
}
