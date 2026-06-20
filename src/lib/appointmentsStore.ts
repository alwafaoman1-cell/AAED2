// مواعيد العملاء — حجز/جدولة زيارات الصيانة
import { createStore } from "./createStore";

export interface Appointment {
  id: string;
  customer: string;
  customerPhone?: string;
  plate?: string;
  date: string;            // ISO yyyy-mm-dd
  time: string;            // HH:mm
  service: string;         // نوع الخدمة المطلوبة
  notes?: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  createdAt: string;
}

export const appointmentsStore = createStore<Appointment>({
  key: "alwafa_appointments_v1",
  seed: [],
});

function norm(s: string) { return (s || "").trim().toLowerCase().replace(/\s+/g, " "); }

export function getCustomerAppointments(customer: string): Appointment[] {
  const k = norm(customer);
  return appointmentsStore.getAll()
    .filter((a) => norm(a.customer) === k)
    .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
}
