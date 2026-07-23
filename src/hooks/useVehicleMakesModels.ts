import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";

export interface VehicleMake {
  id: string;
  name: string;
  name_ar: string | null;
  is_global: boolean;
  tenant_id: string | null;
}

export interface VehicleModel {
  id: string;
  make_id: string;
  name: string;
  name_ar: string | null;
  is_global: boolean;
  tenant_id: string | null;
}

export const useVehicleMakes = () =>
  useQuery({
    queryKey: queryKeys.vehicleCatalog.makes,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vehicle_makes")
        .select("*")
        .order("name", { ascending: true });
      if (error) throw error;
      return data as VehicleMake[];
    },
  });

export const useVehicleModels = (makeId: string | string[] | null) =>
  useQuery({
    queryKey: queryKeys.vehicleCatalog.models(Array.isArray(makeId) ? makeId.join(",") : makeId),
    enabled: Array.isArray(makeId) ? makeId.length > 0 : !!makeId,
    queryFn: async () => {
      let query = supabase
        .from("vehicle_models")
        .select("*")
        .order("name", { ascending: true });

      if (Array.isArray(makeId)) {
        query = query.in("make_id", makeId);
      } else {
        query = query.eq("make_id", makeId!);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as VehicleModel[];
    },
  });

export const useCreateMake = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (name: string) => {
      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      const { data, error } = await supabase
        .from("vehicle_makes")
        .insert({ name: name.trim(), tenant_id: tenant as string, is_global: false })
        .select()
        .single();
      if (error) throw error;
      return data as VehicleMake;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleCatalog.makes });
      toast.success("تمت إضافة الماركة");
    },
    onError: (e: any) => toast.error("فشل إضافة الماركة: " + e.message),
  });
};

export const useCreateModel = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ makeId, name }: { makeId: string; name: string }) => {
      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      const { data, error } = await supabase
        .from("vehicle_models")
        .insert({ make_id: makeId, name: name.trim(), tenant_id: tenant as string, is_global: false })
        .select()
        .single();
      if (error) throw error;
      return data as VehicleModel;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.vehicleCatalog.models(vars.makeId) });
      toast.success("تمت إضافة الموديل");
    },
    onError: (e: any) => toast.error("فشل إضافة الموديل: " + e.message),
  });
};
