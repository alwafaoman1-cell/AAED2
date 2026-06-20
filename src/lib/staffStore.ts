import { createStore } from "./createStore";

export interface Technician {
  id: string;
  name: string;
  role: string;
  completedThisMonth: number;
  rating: number;
  currentCar: string;
  status: string;
  totalCompleted: number;
}

export const staffStore = createStore<Technician>({
  key: "alwafa_staff_v1",
  seed: [
    { id: "T-1", name: "عبدالله الغامدي", role: "فني ميكانيكا", completedThisMonth: 18, rating: 4.8, currentCar: "تويوتا كامري", status: "يعمل", totalCompleted: 245 },
    { id: "T-2", name: "يوسف القحطاني", role: "فني كهرباء", completedThisMonth: 15, rating: 4.6, currentCar: "شيفروليه تاهو", status: "يعمل", totalCompleted: 198 },
    { id: "T-3", name: "ماجد الدوسري", role: "فني حوادث", completedThisMonth: 12, rating: 4.9, currentCar: "-", status: "متاح", totalCompleted: 312 },
    { id: "T-4", name: "سامي العنزي", role: "فني برمجة", completedThisMonth: 8, rating: 4.5, currentCar: "لكزس ES", status: "يعمل", totalCompleted: 156 },
  ],
});
