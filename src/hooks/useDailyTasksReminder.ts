import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "daily_tasks_reminder_last_shown";

export function useDailyTasksReminder() {
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const last = localStorage.getItem(STORAGE_KEY);
      if (last === today) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from("daily_tasks" as any)
        .select("id, title, priority, status")
        .eq("due_date", today)
        .neq("status", "done");
      if (error || cancelled) return;
      const tasks = (data ?? []) as any[];
      localStorage.setItem(STORAGE_KEY, today);
      if (!tasks.length) {
        toast.success("☀️ صباح الخير! لا توجد مهام مستحقة اليوم", { duration: 4000 });
        return;
      }
      const urgentCount = tasks.filter(t => t.priority === "urgent" || t.priority === "high").length;
      toast(`☀️ لديك ${tasks.length} مهمة اليوم${urgentCount ? ` (${urgentCount} عاجلة)` : ""}`, {
        description: tasks.slice(0, 3).map(t => `• ${t.title}`).join("\n"),
        duration: 12000,
        action: { label: "عرض المهام", onClick: () => navigate("/tasks") },
      });
    })();
    return () => { cancelled = true; };
  }, [navigate]);
}
