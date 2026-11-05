import {Children,cloneElement,isValidElement,useId,type ReactNode,type ReactElement} from "react";
import {Input} from "@/components/ui/input";
import {Textarea} from "@/components/ui/textarea";
import {Label} from "@/components/ui/label";
import {Card} from "@/components/ui/card";
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const labelId = `${id}-label`;
  let control: ReactElement<{ id?: string }> | undefined;
  Children.forEach(children, (child) => {
    if (!control && isValidElement<{ id?: string }>(child) && (child.type === Input || child.type === Textarea)) control = child;
  });
  const controlId = control?.props.id || id;
  return (
    <div className="space-y-1.5" role={control ? undefined : "group"} aria-labelledby={control ? undefined : labelId}>
      <Label id={labelId} htmlFor={control ? controlId : undefined}>{label}</Label>
      {Children.map(children, (child) => control && child === control ? cloneElement(control, { id: controlId }) : child)}
    </div>
  );
}

export function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  const id = useId();
  return (
    <Card className="p-4 space-y-4" role="region" aria-labelledby={`${id}-title`} aria-describedby={desc ? `${id}-description` : undefined}>
      <div>
        <h2 id={`${id}-title`} className="font-bold text-lg">{title}</h2>
        {desc && <p id={`${id}-description`} className="text-xs text-muted-foreground mt-1">{desc}</p>}
      </div>
      {children}
    </Card>
  );
}


