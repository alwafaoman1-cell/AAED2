import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { appointmentsStore, type Appointment } from "@/lib/appointmentsStore";
import { logActivity } from "@/lib/auditLogStore";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customer: { name: string; phone?: string };
  defaultPlate?: string;
  initial?: Appointment | null;
}

const SERVICES = [
  "صيانة دورية", "فحص شامل", "حادث/تصليح", "كهرباء", "ميكانيكا", "صبغ", "أخرى",
];

export default function AppointmentFormDialog({ open, onOpenChange, customer, defaultPlate, initial }: Props) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [time, setTime] = useState("10:00");
  const [service, setService] = useState(SERVICES[0]);
  const [plate, setPlate] = useState(defaultPlate || "");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (initial) {
      setDate(initial.date); setTime(initial.time);
      setService(initial.service); setPlate(initial.plate || "");
      setNotes(initial.notes || "");
    } else {
      setDate(new Date().toISOString().split("T")[0]);
      setTime("10:00"); setService(SERVICES[0]);
      setPlate(defaultPlate || ""); setNotes("");
    }
  }, [initial, open, defaultPlate]);

  function handleSave() {
    if (!date || !time) { toast.error("اختر التاريخ والوقت"); return; }
    if (initial) {
      appointmentsStore.update(initial.id, { date, time, service, plate, notes });
      toast.success("تم تعديل الموعد");
    } else {
      const id = `APT-${Date.now()}`;
      appointmentsStore.add({
        id, customer: customer.name, customerPhone: customer.phone,
        plate, date, time, service, notes,
        status: "scheduled",
        createdAt: new Date().toISOString(),
      });
      logActivity({
        action: "create", entity: "customer", entityId: id,
        label: `موعد ${customer.name} - ${date} ${time}`,
        description: `${service}${plate ? ` (${plate})` : ""}`,
      });
      toast.success("تم تسجيل الموعد");
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "تعديل موعد" : "حجز موعد جديد"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">التاريخ</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">الوقت</Label>
              <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">نوع الخدمة</Label>
            <Select value={service} onValueChange={setService}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SERVICES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">السيارة (رقم اللوحة)</Label>
            <Input value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="اختياري" />
          </div>
          <div>
            <Label className="text-xs">ملاحظات</Label>
            <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>إلغاء</Button>
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground">حفظ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
