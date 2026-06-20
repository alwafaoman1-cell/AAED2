import { useEffect, useState } from "react";
import { pendingCount, subscribeQueue } from "@/lib/offlineQueue";

export function useOnlineStatus() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queued, setQueued] = useState(0);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    const refresh = () => pendingCount().then((n) => mounted && setQueued(n)).catch(() => {});
    refresh();
    const unsub = subscribeQueue(refresh);
    return () => { mounted = false; unsub(); };
  }, []);

  return { online, queued };
}
