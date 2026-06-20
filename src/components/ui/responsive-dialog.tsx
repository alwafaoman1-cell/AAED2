/**
 * ResponsiveDialog — يعرض كـ Sheet ملء الشاشة على الجوال (سهل الإدخال)
 * وكـ Dialog مركزي على الديسكتوب. يحل محل Dialog القياسي بدون كسر الـ API.
 *
 * استخدم بدلاً من <Dialog> في النماذج الكبيرة. الـ children يبقى كما هو.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

interface ResponsiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  /** على الجوال يفتح من أسفل افتراضياً (أسهل للوصول بالإبهام) */
  mobileSide?: "bottom" | "right" | "left" | "top";
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  children,
  className,
  mobileSide = "bottom",
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={mobileSide}
          className={cn(
            "h-[95vh] w-full max-w-full p-0 flex flex-col",
            "rounded-t-2xl border-t-2",
            className,
          )}
        >
          <div className="overflow-y-auto flex-1 p-4 pb-24">{children}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-2xl", className)}>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// Re-exports موحّدة لتسهيل الاستبدال (نفس API من Dialog)
export const ResponsiveDialogHeader = ({ className, ...p }: React.ComponentProps<typeof DialogHeader>) => {
  const m = useIsMobile();
  return m
    ? <SheetHeader className={cn("text-right pb-3 border-b", className)} {...p} />
    : <DialogHeader className={className} {...p} />;
};

export const ResponsiveDialogTitle = ({ className, ...p }: React.ComponentProps<typeof DialogTitle>) => {
  const m = useIsMobile();
  return m
    ? <SheetTitle className={cn("text-xl text-right", className)} {...p} />
    : <DialogTitle className={className} {...p} />;
};

export const ResponsiveDialogDescription = ({ className, ...p }: React.ComponentProps<typeof DialogDescription>) => {
  const m = useIsMobile();
  return m
    ? <SheetDescription className={cn("text-right", className)} {...p} />
    : <DialogDescription className={className} {...p} />;
};

export const ResponsiveDialogFooter = ({ className, ...p }: React.ComponentProps<typeof DialogFooter>) => {
  const m = useIsMobile();
  return m
    ? (
      <SheetFooter
        className={cn(
          "fixed bottom-0 inset-x-0 bg-background border-t p-3 flex-row gap-2",
          className,
        )}
        {...p}
      />
    )
    : <DialogFooter className={className} {...p} />;
};
