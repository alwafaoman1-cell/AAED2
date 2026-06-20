import { CheckCircle, Clock, Car, Search, Wrench, FileCheck, Truck, Shield } from "lucide-react";

interface TrackingStage {
  key: string;
  label: string;
  icon: React.ElementType;
  date?: string;
  active: boolean;
  completed: boolean;
}

interface VehicleTrack {
  orderId: string;
  customer: string;
  vehicle: string;
  plate: string;
  currentStage: string;
  stages: TrackingStage[];
}

const stageConfig = [
  { key: "received", label: "الاستقبال", icon: Car },
  { key: "inspection", label: "الفحص", icon: Search },
  { key: "quote", label: "عرض السعر", icon: FileCheck },
  { key: "insurance", label: "موافقة التأمين", icon: Shield },
  { key: "in_progress", label: "تحت الإصلاح", icon: Wrench },
  { key: "completed", label: "جاهز للتسليم", icon: CheckCircle },
  { key: "delivered", label: "تم التسليم", icon: Truck },
];

function buildStages(currentKey: string): TrackingStage[] {
  const currentIdx = stageConfig.findIndex(s => s.key === currentKey);
  return stageConfig.map((s, i) => ({
    ...s,
    active: i === currentIdx,
    completed: i < currentIdx,
    date: i <= currentIdx ? `2024-03-${25 + i}` : undefined,
  }));
}

const tracks: VehicleTrack[] = [
  { orderId: "WO-2024-001", customer: "أحمد محمد", vehicle: "تويوتا كامري 2023", plate: "أ ب ج 1234", currentStage: "in_progress", stages: buildStages("in_progress") },
  { orderId: "WO-2024-002", customer: "خالد العتيبي", vehicle: "هوندا أكورد 2022", plate: "ه و ز 5678", currentStage: "insurance", stages: buildStages("insurance") },
  { orderId: "WO-2024-003", customer: "سعد الحربي", vehicle: "نيسان باترول 2024", plate: "ط ي ك 9012", currentStage: "completed", stages: buildStages("completed") },
  { orderId: "WO-2024-005", customer: "محمد الشمري", vehicle: "شيفروليه تاهو 2024", plate: "س ع ف 7890", currentStage: "inspection", stages: buildStages("inspection") },
];

export default function VehicleTracking() {
  return (
    <div className="space-y-4">
      {tracks.map(track => (
        <div key={track.orderId} className="bg-card border border-border rounded-xl p-4 shadow-card">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-primary">{track.orderId}</span>
                <span className="text-xs text-muted-foreground font-mono">{track.plate}</span>
              </div>
              <p className="text-foreground font-medium text-sm">{track.customer} — {track.vehicle}</p>
            </div>
            <span className="text-[10px] px-3 py-1 rounded-full bg-primary/10 text-primary font-medium">
              {stageConfig.find(s => s.key === track.currentStage)?.label}
            </span>
          </div>

          {/* Timeline */}
          <div className="flex items-center gap-0 overflow-x-auto pb-2">
            {track.stages.map((stage, i) => {
              const Icon = stage.icon;
              return (
                <div key={stage.key} className="flex items-center">
                  <div className="flex flex-col items-center min-w-[70px]">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                      stage.completed
                        ? "bg-success text-success-foreground"
                        : stage.active
                        ? "gradient-gold text-primary-foreground ring-2 ring-primary/30 ring-offset-2 ring-offset-card"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      {stage.completed ? <CheckCircle size={14} /> : <Icon size={14} />}
                    </div>
                    <span className={`text-[9px] mt-1 text-center leading-tight ${
                      stage.active ? "text-primary font-semibold" : stage.completed ? "text-success" : "text-muted-foreground"
                    }`}>
                      {stage.label}
                    </span>
                    {stage.date && (
                      <span className="text-[8px] text-muted-foreground">{stage.date}</span>
                    )}
                  </div>
                  {i < track.stages.length - 1 && (
                    <div className={`h-0.5 w-6 sm:w-8 mt-[-16px] ${
                      stage.completed ? "bg-success" : "bg-border"
                    }`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
