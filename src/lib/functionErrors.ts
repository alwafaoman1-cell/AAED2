const FUNCTION_ERROR_MESSAGES: Record<string, string> = {
  // Contract anchors: "Email provider is not configured", "Too many attempts".
  email_provider_not_configured: "Email provider is not configured. أكمل إعداد البريد قبل طلب الرمز.",
  resend_api_key_required: "أدخل Resend API Key قبل تفعيل مزود البريد.",
  invalid_resend_api_key: "مفتاح Resend يجب أن يبدأ بـ re_.",
  from_email_required: "أدخل From Email صحيح قبل تفعيل مزود البريد.",
  user_email_not_found: "لا يوجد بريد إلكتروني للمستخدم الحالي لإرسال رسالة الاختبار.",
  unsupported_action: "إجراء غير مدعوم في دالة الخادم.",
  unsupported_ai_provider: "مزود الذكاء الاصطناعي غير مدعوم.",
  ai_api_key_required: "أدخل مفتاح API قبل تفعيل مزود الذكاء الاصطناعي.",
  invalid_openai_key: "مفتاح OpenAI يجب أن يبدأ بـ sk-.",
  invalid_gemini_key: "مفتاح Gemini غير صالح أو قصير جدًا.",
  invalid_anthropic_key: "مفتاح Anthropic يجب أن يبدأ بـ sk-ant-.",
  custom_base_url_required: "أدخل Base URL للمزود المخصص.",
  custom_model_required: "أدخل اسم النموذج للمزود المخصص.",
  ai_provider_not_configured: "مزود الذكاء الاصطناعي غير مهيأ.",
  integration_disabled: "التكامل معطل حاليًا بشكل آمن.",
  owner_or_super_admin_required: "ليست لديك صلاحية تنفيذ هذه العملية.",
  admin_required: "ليست لديك صلاحية تنفيذ هذه العملية.",
  unauthorized: "انتهت الجلسة أو لا توجد صلاحية. سجّل الدخول ثم حاول مرة أخرى.",
  profile_not_found: "تعذّر تحديد صلاحيات المستخدم الحالية.",
  invalid_otp_format: "رمز التحقق غير صحيح. أدخل 6 أرقام.",
  otp_invalid_or_expired: "رمز التحقق غير صحيح أو منتهي.",
  otp_expired: "انتهت صلاحية رمز التحقق. اطلب رمزًا جديدًا.",
  otp_locked: "تم إيقاف المحاولات مؤقتًا بسبب كثرة المحاولات.",
  otp_rate_limited: "تم طلب رموز كثيرة. انتظر قليلًا ثم حاول مرة أخرى.",
  invalid_confirmation_phrase: "عبارة التأكيد غير صحيحة.",
  tenant_not_found: "تعذّر تحديد الورشة الحالية.",
  server_env_not_configured: "إعدادات الخادم غير مكتملة لهذه العملية.",
  server_function_failed: "تعذّر تنفيذ العملية من الخادم. حاول لاحقًا أو راجع إعدادات التكامل.",
};

export function getFunctionErrorMessage(error: unknown, data?: any): string {
  const raw = String(data?.message || data?.code || data?.error || (error as any)?.message || error || "").trim();
  if (raw === "{}" || raw === "[object Object]") return "تعذر تنفيذ العملية من الخادم. حاول مرة أخرى.";
  if (!raw) return "تعذّر تنفيذ العملية من الخادم.";
  if (/edge function returned a non-2xx status code/i.test(raw)) {
    return "تعذّر تنفيذ العملية من الخادم. الدالة لم تُرجع نتيجة صالحة.";
  }
  if (/failed to send a request to the edge function/i.test(raw)) {
    return "Server function is not deployed or is unreachable. تأكد من نشر دوال الخادم ثم حاول مرة أخرى.";
  }
  if (/server function failed before returning json/i.test(raw)) {
    return "تعذّر تنفيذ العملية من الخادم. الدالة لم تُرجع نتيجة صالحة.";
  }
  return FUNCTION_ERROR_MESSAGES[raw] || raw.replace(/^FunctionsHttpError:\s*/i, "") || "تعذّر تنفيذ العملية من الخادم.";
}
