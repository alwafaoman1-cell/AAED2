import { Outlet } from "react-router-dom";
import { useTranslation } from "react-i18next";
import AppSidebar from "./AppSidebar";
import NotificationsBell from "./NotificationsBell";
import LanguageSwitcher from "./LanguageSwitcher";
import DateTimeDisplay from "./DateTimeDisplay";
import ThemeToggle from "./ThemeToggle";
import QuickActionsFAB from "./QuickActionsFAB";
import AutoBreadcrumb from "./AutoBreadcrumb";
import NavHistoryButtons from "./NavHistoryButtons";
import { HideAmountsToggle, RefreshDataButton } from "./TopBarActions";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useDailyTasksReminder } from "@/hooks/useDailyTasksReminder";
import PortalNotesRealtimeListener from "./PortalNotesRealtimeListener";
import UpdateNotice from "./UpdateNotice";
import FeatureGate from "./FeatureGate";
import VehicleReturnContextBar from "./vehicles/VehicleReturnContextBar";

export default function AppLayout() {
  // مزامنة فورية مع جميع الجداول الحرجة (المطالبات/الفواتير/أوامر العمل/الدفعات)
  useRealtimeSync();
  useDailyTasksReminder();
  // Navigation is read-only. Confirmed lifecycle/financial commands own writes;
  // never reconcile vehicle archive or historical journals from a layout effect.

  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";

  // Push the main content away from the side where the sidebar is pinned.
  const mainOffset = isRtl ? "lg:mr-[260px]" : "lg:ml-[260px]";

  return (
    <div className="min-h-screen bg-background">
      <AppSidebar />
      <main className={`${mainOffset} transition-all duration-300`}>
        {/* Top bar — يترك مساحة لزر القائمة الموبايل ودعم safe-area للجوال/PWA */}
        <div className="app-top-bar sticky top-0 z-30 flex items-center justify-between gap-1 sm:gap-2 ps-14 pe-2 sm:ps-16 sm:pe-4 md:pe-6 lg:px-8 min-h-12 pb-2 border-b border-border bg-background/80 backdrop-blur">
          <div className="flex shrink-0 items-center">
            <NavHistoryButtons />
          </div>
          <div className="flex items-center gap-0.5 sm:gap-2 shrink-0">
            <div className="hidden sm:flex"><RefreshDataButton /></div>
            <HideAmountsToggle />
            <div className="hidden md:flex"><DateTimeDisplay /></div>
            <LanguageSwitcher compactOnMobile />
            <ThemeToggle />
            <NotificationsBell />
          </div>
        </div>
        <AutoBreadcrumb />
        <VehicleReturnContextBar />
        <div className="p-3 md:p-6 lg:p-8">
          <FeatureGate>
            <Outlet />
          </FeatureGate>
        </div>
      </main>
      <QuickActionsFAB />
      <PortalNotesRealtimeListener />
      <UpdateNotice />
    </div>
  );
}
