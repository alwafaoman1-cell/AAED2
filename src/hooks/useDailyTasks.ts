import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type TaskStatus = "pending" | "in_progress" | "done";

export interface DailyTask {
  id: string;
  tenant_id: string;
  user_id: string | null;
  title: string;
  description: string | null;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export function useDailyTasks(filter?: { date?: string; status?: TaskStatus | "all" }) {
  return useQuery({
    queryKey: ["daily_tasks", filter?.date ?? "all", filter?.status ?? "all"],
    queryFn: async () => {
      let q = supabase.from("daily_tasks" as any).select("*").order("priority", { ascending: false }).order("created_at");
      if (filter?.date) q = q.eq("due_date", filter.date);
      if (filter?.status && filter.status !== "all") q = q.eq("status", filter.status);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as DailyTask[];
    },
  });
}

export function useTodayTasks() {
  const today = new Date().toISOString().slice(0, 10);
  return useDailyTasks({ date: today });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Partial<DailyTask>) => {
      const { data: tenantId } = await supabase.rpc("get_user_tenant_id");
      const { data: { user } } = await supabase.auth.getUser();
      const { error, data } = await supabase.from("daily_tasks" as any).insert({
        tenant_id: tenantId,
        user_id: user?.id ?? null,
        title: payload.title!,
        description: payload.description ?? null,
        due_date: payload.due_date ?? new Date().toISOString().slice(0, 10),
        priority: payload.priority ?? "normal",
        status: payload.status ?? "pending",
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily_tasks"] });
      toast.success("تم إضافة المهمة");
    },
    onError: (e: any) => toast.error(e?.message ?? "تعذر الحفظ"),
  });
}

export function useUpdateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...patch }: Partial<DailyTask> & { id: string }) => {
      const updates: any = { ...patch };
      if (patch.status === "done") updates.completed_at = new Date().toISOString();
      if (patch.status && patch.status !== "done") updates.completed_at = null;
      const { error } = await supabase.from("daily_tasks" as any).update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["daily_tasks"] }),
    onError: (e: any) => toast.error(e?.message ?? "تعذر التحديث"),
  });
}

export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("daily_tasks" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["daily_tasks"] });
      toast.success("تم الحذف");
    },
  });
}
