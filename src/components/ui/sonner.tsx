import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-center"
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-2xl group-[.toaster]:rounded-xl group-[.toaster]:px-4 group-[.toaster]:py-3",
          title: "group-[.toast]:text-foreground group-[.toast]:font-semibold",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground group-[.toast]:hover:opacity-90",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          closeButton:
            "group-[.toast]:bg-card group-[.toast]:text-foreground group-[.toast]:border-border",
          success:
            "group-[.toaster]:!border-success/40 group-[.toaster]:!bg-success/10",
          error:
            "group-[.toaster]:!border-destructive/40 group-[.toaster]:!bg-destructive/10",
          warning:
            "group-[.toaster]:!border-warning/40 group-[.toaster]:!bg-warning/10",
          info:
            "group-[.toaster]:!border-info/40 group-[.toaster]:!bg-info/10",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
