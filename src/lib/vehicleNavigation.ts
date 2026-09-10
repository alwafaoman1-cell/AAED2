export function withVehicleReturnContext(path: string, vehicleId?: string | null) {
  if (!vehicleId) return path;
  if (/[?&]fromVehicle=/.test(path)) return path;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}fromVehicle=${encodeURIComponent(vehicleId)}`;
}
