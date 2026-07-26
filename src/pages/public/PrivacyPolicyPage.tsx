const updatedAt = "26 July 2026";

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <div className="mx-auto max-w-4xl px-5 py-10 sm:px-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-10">
          <div className="mb-8 border-b border-slate-200 pb-6">
            <p className="text-sm text-slate-500">Al Wafa Integrated Business Company LLC</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
              Privacy Policy
            </h1>
            <p className="mt-2 text-sm text-slate-500">Last updated: {updatedAt}</p>
          </div>

          <div className="space-y-7 leading-7 text-slate-700">
            <section>
              <h2 className="text-xl font-semibold text-slate-950">1. Who we are</h2>
              <p className="mt-2">
                This Privacy Policy applies to Al Wafa Integrated Business Company LLC and its
                workshop management system used for vehicle repair, insurance claim handling,
                customer communication, invoices, estimates, and service tracking.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">2. Information we collect</h2>
              <p className="mt-2">
                We may collect customer name, phone number, vehicle details, plate number, claim
                information, work order details, photos or documents provided for repair/insurance
                processing, invoice/payment records, and communication history related to workshop
                services.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">3. How we use information</h2>
              <p className="mt-2">
                We use this information to manage vehicle repair services, insurance claims,
                estimates, invoices, customer updates, delivery receipts, support requests, and
                official workshop records.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">4. WhatsApp and messaging</h2>
              <p className="mt-2">
                If you contact us or receive service updates through WhatsApp, SMS, or email, we may
                process your phone number, message content, delivery status, and related work order
                or claim reference. We use these messages only for service communication, reminders,
                repair updates, approvals, and customer support.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">5. Sharing information</h2>
              <p className="mt-2">
                We do not sell customer personal information. We may share necessary information
                with insurance companies, service providers, payment providers, hosting providers,
                or authorities when required to complete services, maintain records, comply with law,
                or protect our rights.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">6. Storage and security</h2>
              <p className="mt-2">
                We use reasonable administrative and technical safeguards to protect information in
                our workshop system. Access is restricted to authorized users according to their
                roles. No online system can be guaranteed to be completely secure.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">7. Data retention</h2>
              <p className="mt-2">
                We keep service, repair, claim, invoice, and communication records for as long as
                required for business operations, accounting, legal, warranty, insurance, and audit
                purposes.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">8. Your choices</h2>
              <p className="mt-2">
                You may contact us to request access, correction, or deletion of your personal
                information where legally and operationally possible. Some records may need to be
                retained for accounting, insurance, or legal obligations.
              </p>
            </section>

            <section>
              <h2 className="text-xl font-semibold text-slate-950">9. Contact us</h2>
              <p className="mt-2">
                For privacy questions or data requests, contact:
              </p>
              <div className="mt-3 rounded-xl bg-slate-50 p-4 text-sm">
                <p>Al Wafa Integrated Business Company LLC</p>
                <p>Email: alwafa.oman1@gmail.com</p>
                <p>Phone: +968 9908 0203</p>
                <p>Muscat, Sultanate of Oman</p>
              </div>
            </section>
          </div>
        </section>

        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 text-right shadow-sm sm:p-10" dir="rtl">
          <div className="mb-6 border-b border-slate-200 pb-5">
            <p className="text-sm text-slate-500">شركة الوفاء للأعمال المتكاملة ش.م.م</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">سياسة الخصوصية</h2>
            <p className="mt-2 text-sm text-slate-500">آخر تحديث: {updatedAt}</p>
          </div>

          <div className="space-y-5 leading-8 text-slate-700">
            <p>
              توضح هذه السياسة كيفية جمع واستخدام وحماية البيانات داخل نظام الورشة الخاص
              بشركة الوفاء للأعمال المتكاملة ش.م.م، بما يشمل بيانات العملاء والمركبات
              وأوامر العمل والمطالبات التأمينية والفواتير والمراسلات.
            </p>
            <p>
              نستخدم البيانات لتقديم خدمات الصيانة والإصلاح، متابعة المطالبات، إصدار
              التقديرات والفواتير، إرسال تحديثات الخدمة عبر واتساب أو البريد الإلكتروني أو
              الرسائل، وحفظ السجلات التشغيلية والمحاسبية المطلوبة.
            </p>
            <p>
              لا نبيع بيانات العملاء. وقد تتم مشاركة البيانات الضرورية فقط مع شركات
              التأمين أو مزودي الخدمة أو الجهات المختصة عند الحاجة لإتمام الخدمة أو
              الامتثال للمتطلبات القانونية والمحاسبية.
            </p>
            <p>
              للاستفسارات المتعلقة بالخصوصية يمكن التواصل عبر البريد الإلكتروني:
              {" "}
              <span dir="ltr">alwafa.oman1@gmail.com</span>
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
