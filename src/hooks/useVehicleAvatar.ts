import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/queryKeys";
import {
  deleteVehicleAvatar,
  getVehicleAvatar,
  uploadVehicleAvatar,
  type VehicleAvatarRecord,
} from "@/lib/vehicleAvatarService";

export function useVehicleAvatar(vehicleId?: string | null) {
  return useQuery({
    queryKey: queryKeys.vehicleMedia.avatar(vehicleId),
    enabled: !!vehicleId,
    queryFn: () => getVehicleAvatar(vehicleId),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUploadVehicleAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: uploadVehicleAvatar,
    onSuccess: (avatar) => {
      qc.setQueryData<VehicleAvatarRecord | null>(queryKeys.vehicleMedia.avatar(avatar.vehicle_id), avatar);
      qc.invalidateQueries({ queryKey: queryKeys.vehicles.all });
      toast.success("Vehicle avatar saved");
    },
    onError: (error: any) => toast.error(error?.message || "Could not save vehicle avatar"),
  });
}

export function useDeleteVehicleAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteVehicleAvatar,
    onSuccess: (_result, vehicleId) => {
      qc.setQueryData(queryKeys.vehicleMedia.avatar(vehicleId), null);
      qc.invalidateQueries({ queryKey: queryKeys.vehicles.all });
      toast.success("Vehicle avatar removed");
    },
    onError: (error: any) => toast.error(error?.message || "Could not remove vehicle avatar"),
  });
}
