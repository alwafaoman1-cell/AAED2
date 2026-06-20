---
name: Customer Mandatory Lookup
description: نظام بحث موحّد للعميل بالهاتف مع إنشاء إجباري + دعم Insurance Pending للمركبات بدون عميل
type: feature
---

## النظرة العامة
كل شاشة تحتاج عميلاً تستخدم `<CustomerPhoneLookup>` بدلاً من حقول الهاتف/الاسم المنفصلة. لا يمكن إكمال أي عملية بدون اختيار عميل موجود أو إنشاء جديد عبر `<NewCustomerDialog>`.

## المكونات
- `src/components/customers/NewCustomerDialog.tsx` — حوار إنشاء (فرد/شركة) مع حقول ديناميكية (سجل تجاري + ضريبي + شخص مسؤول للشركات، بطاقة مدنية للأفراد).
- `src/components/customers/CustomerPhoneLookup.tsx` — حقل بحث بالهاتف/الاسم مع قائمة منسدلة + زر «إضافة عميل جديد (إلزامي)» يفتح الحوار، وبطاقة العميل المختار بعد الاختيار مع شارة Insurance Pending عند الحاجة.
- `customersStore.isInsurancePending(name)` — يكتشف العميل الافتراضي للتأمين.
- `customersStore.getOrCreateInsurancePending(insuranceCompany)` — ينشئ/يُرجع عميل افتراضي اسمه `Insurance Pending - {شركة}` (واحد لكل شركة تأمين).

## قواعد العمل
- `WorkOrder.customerId` صار مرجعاً موحّداً للعميل (إضافة لاسم/هاتف للتوافق).
- في `WorkOrderForm`: لا يُحفظ الأمر بدون customerId. لو الشركة محددة وفعل المستخدم زر «استخدام Insurance Pending»، يتم تعيين العميل الافتراضي.
- **قاعدة التسليم (إلزامية)**: لا يُسمح بنقل أمر العمل إلى حالة `تم التسليم` أو `جاهز للتسليم` أو `مغلق` بينما العميل = Insurance Pending. يجب استبداله بالعميل الحقيقي أولاً.

## نطاق التطبيق
المرحلة 1 (مطبّقة): WorkOrderForm. باقي النقاط (منع المطالبة من WO، WhatsApp اقتراحي، فنيين من القائمة فقط، توقيع، تقديرات/مطالبات/فواتير) ستُطبّق في مراحل لاحقة باستخدام نفس المكون.
