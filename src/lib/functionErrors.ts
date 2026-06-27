const FUNCTION_ERROR_MESSAGES: Record<string, string> = {
  email_provider_not_configured: "Email provider is not configured",
  owner_or_super_admin_required: "Permission denied",
  admin_required: "Permission denied",
  unauthorized: "Permission denied",
  profile_not_found: "Permission denied",
  invalid_otp_format: "Invalid OTP",
  otp_invalid_or_expired: "Invalid OTP or OTP expired",
  otp_expired: "OTP expired",
  otp_locked: "Too many attempts. OTP is temporarily locked",
  otp_rate_limited: "Too many attempts. Please wait before requesting another OTP",
  invalid_confirmation_phrase: "Missing or invalid confirmation phrase",
  tenant_not_found: "Server function is not configured",
};

export function getFunctionErrorMessage(error: unknown, data?: any): string {
  const raw = String(data?.error || (error as any)?.message || error || "").trim();
  if (!raw) return "Server function is not configured";
  return FUNCTION_ERROR_MESSAGES[raw] || raw.replace(/^FunctionsHttpError:\s*/i, "") || "Server function is not configured";
}
