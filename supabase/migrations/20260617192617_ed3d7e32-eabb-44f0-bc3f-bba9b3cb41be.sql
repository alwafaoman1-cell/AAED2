
-- نظام إشعارات المدير: رسائل من المدير إلى كل المستخدمين داخل نفس المستأجر
CREATE TABLE public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  sender_id uuid NOT NULL,
  sender_name text,
  title text NOT NULL,
  body text NOT NULL,
  type text NOT NULL DEFAULT 'info' CHECK (type IN ('info','warning','urgent','success','error')),
  link text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- كل من في المستأجر يمكنه قراءة الإشعارات الخاصة بمستأجره
CREATE POLICY "tenant members can read admin notifications"
ON public.admin_notifications FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id());

-- فقط admin/manager يستطيع الإنشاء
CREATE POLICY "admin/manager can create admin notifications"
ON public.admin_notifications FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND sender_id = auth.uid()
  AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
);

-- فقط المرسل أو admin يقدر يحذف
CREATE POLICY "admin or sender can delete admin notifications"
ON public.admin_notifications FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND (sender_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
);

-- جدول حالة القراءة + الحذف الشخصي لكل مستخدم
CREATE TABLE public.admin_notification_reads (
  notification_id uuid NOT NULL REFERENCES public.admin_notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  read_at timestamptz,
  deleted_at timestamptz,
  PRIMARY KEY (notification_id, user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_notification_reads TO authenticated;
GRANT ALL ON public.admin_notification_reads TO service_role;

ALTER TABLE public.admin_notification_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own reads"
ON public.admin_notification_reads FOR ALL TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- تفعيل Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_notifications;
ALTER TABLE public.admin_notifications REPLICA IDENTITY FULL;
