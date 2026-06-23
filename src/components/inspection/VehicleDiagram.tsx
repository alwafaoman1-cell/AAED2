import { useState } from "react";

export interface DamageMarker {
  x: number;
  y: number;
  type: string;
  notes?: string;
}

interface VehicleDiagramProps {
  markers: DamageMarker[];
  onAddMarker: (marker: DamageMarker) => void;
  onRemoveMarker: (index: number) => void;
}

const damageTypes = [
  { value: "scratch", label: "خدش", color: "#f59e0b" },
  { value: "dent", label: "انبعاج", color: "#ef4444" },
  { value: "crack", label: "كسر", color: "#dc2626" },
  { value: "paint", label: "تقشر طلاء", color: "#8b5cf6" },
  { value: "rust", label: "صدأ", color: "#78350f" },
  { value: "missing", label: "قطعة مفقودة", color: "#1d4ed8" },
];

export default function VehicleDiagram({ markers, onAddMarker, onRemoveMarker }: VehicleDiagramProps) {
  const [selectedType, setSelectedType] = useState("scratch");

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    onAddMarker({ x, y, type: selectedType });
  };

  const getColor = (type: string) => damageTypes.find(d => d.value === type)?.color || "#ef4444";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {damageTypes.map(d => (
          <button
            key={d.value}
            type="button"
            onClick={() => setSelectedType(d.value)}
            className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
              selectedType === d.value
                ? "border-primary bg-primary/10 text-primary font-semibold"
                : "border-border text-muted-foreground hover:border-primary/50"
            }`}
          >
            <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ background: d.color }} />
            {d.label}
          </button>
        ))}
      </div>

      <div className="relative bg-secondary/30 rounded-xl border border-border p-4 cursor-crosshair">
        <p className="text-[10px] text-muted-foreground text-center mb-2">انقر على موقع الضرر في السيارة</p>
        <svg
          viewBox="0 0 400 180"
          className="w-full h-auto"
          onClick={handleClick}
          style={{ maxHeight: 250 }}
        >
          {/* Car body - top view */}
          <rect x="80" y="20" width="240" height="140" rx="40" fill="hsl(222, 18%, 18%)" stroke="hsl(222, 15%, 30%)" strokeWidth="2" />
          <rect x="100" y="35" width="200" height="110" rx="30" fill="hsl(222, 18%, 22%)" stroke="hsl(222, 15%, 28%)" strokeWidth="1" />
          
          {/* Windshield */}
          <path d="M140 40 L260 40 L250 70 L150 70 Z" fill="hsl(199, 50%, 30%)" stroke="hsl(199, 40%, 40%)" strokeWidth="1" opacity="0.7" />
          
          {/* Rear window */}
          <path d="M150 110 L250 110 L260 140 L140 140 Z" fill="hsl(199, 50%, 30%)" stroke="hsl(199, 40%, 40%)" strokeWidth="1" opacity="0.7" />
          
          {/* Side mirrors */}
          <ellipse cx="75" cy="65" rx="12" ry="8" fill="hsl(222, 18%, 20%)" stroke="hsl(222, 15%, 30%)" strokeWidth="1" />
          <ellipse cx="325" cy="65" rx="12" ry="8" fill="hsl(222, 18%, 20%)" stroke="hsl(222, 15%, 30%)" strokeWidth="1" />
          
          {/* Wheels */}
          <circle cx="120" cy="30" r="15" fill="hsl(0, 0%, 15%)" stroke="hsl(0, 0%, 25%)" strokeWidth="2" />
          <circle cx="280" cy="30" r="15" fill="hsl(0, 0%, 15%)" stroke="hsl(0, 0%, 25%)" strokeWidth="2" />
          <circle cx="120" cy="150" r="15" fill="hsl(0, 0%, 15%)" stroke="hsl(0, 0%, 25%)" strokeWidth="2" />
          <circle cx="280" cy="150" r="15" fill="hsl(0, 0%, 15%)" stroke="hsl(0, 0%, 25%)" strokeWidth="2" />
          
          {/* Wheel rims */}
          <circle cx="120" cy="30" r="8" fill="none" stroke="hsl(0, 0%, 35%)" strokeWidth="1" />
          <circle cx="280" cy="30" r="8" fill="none" stroke="hsl(0, 0%, 35%)" strokeWidth="1" />
          <circle cx="120" cy="150" r="8" fill="none" stroke="hsl(0, 0%, 35%)" strokeWidth="1" />
          <circle cx="280" cy="150" r="8" fill="none" stroke="hsl(0, 0%, 35%)" strokeWidth="1" />
          
          {/* Headlights */}
          <ellipse cx="120" cy="25" rx="20" ry="5" fill="hsl(42, 90%, 55%)" opacity="0.3" />
          <ellipse cx="280" cy="25" rx="20" ry="5" fill="hsl(42, 90%, 55%)" opacity="0.3" />

          {/* Labels */}
          <text x="200" y="15" textAnchor="middle" fill="hsl(215, 15%, 45%)" fontSize="10" fontFamily="sans-serif">أمام</text>
          <text x="200" y="178" textAnchor="middle" fill="hsl(215, 15%, 45%)" fontSize="10" fontFamily="sans-serif">خلف</text>
          <text x="55" y="95" textAnchor="middle" fill="hsl(215, 15%, 45%)" fontSize="10" fontFamily="sans-serif">يمين</text>
          <text x="345" y="95" textAnchor="middle" fill="hsl(215, 15%, 45%)" fontSize="10" fontFamily="sans-serif">يسار</text>

          {/* Damage markers */}
          {markers.map((m, i) => (
            <g key={i} onClick={(e) => { e.stopPropagation(); onRemoveMarker(i); }} style={{ cursor: "pointer" }}>
              <circle cx={m.x * 4} cy={m.y * 1.8} r="8" fill={getColor(m.type)} opacity="0.8" stroke="white" strokeWidth="1.5" />
              <text x={m.x * 4} y={m.y * 1.8 + 4} textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">
                {i + 1}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {markers.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">الأضرار المسجلة ({markers.length}):</p>
          <div className="flex flex-wrap gap-2">
            {markers.map((m, i) => {
              const dt = damageTypes.find(d => d.value === m.type);
              return (
                <span
                  key={i}
                  className="text-[10px] px-2 py-1 rounded-full border border-border text-foreground flex items-center gap-1 cursor-pointer hover:bg-destructive/10"
                  onClick={() => onRemoveMarker(i)}
                  title="انقر للحذف"
                >
                  <span className="w-2 h-2 rounded-full" style={{ background: dt?.color }} />
                  {i + 1}. {dt?.label}
                  <span className="text-destructive">✕</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
