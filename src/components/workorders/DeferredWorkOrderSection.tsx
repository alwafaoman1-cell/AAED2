import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import "@/lib/i18n/performanceReadSummaries";

/** Optional sections activate on approach or an explicit accessible request. */
export function DeferredWorkOrderSection({ title, children }: { title: string; children: ReactNode }) {
  const {t}=useTranslation();const ref=useRef<HTMLDivElement>(null);const [active,setActive]=useState(false);
  useEffect(()=>{
    if(active)return;
    if(typeof IntersectionObserver==="undefined"){setActive(true);return;}
    const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setActive(true);observer.disconnect();}},{rootMargin:"160px"});
    if(ref.current)observer.observe(ref.current);
    return()=>observer.disconnect();
  },[active]);
  return <div ref={ref} className="min-w-0">{active?children:<div className="flex min-h-24 items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><h2 className="text-sm font-semibold">{title}</h2><Button size="sm" variant="outline" aria-label={`${t("performanceRead.loadSection")} · ${title}`} onClick={()=>setActive(true)}>{t("performanceRead.show")}</Button></div>}</div>;
}
