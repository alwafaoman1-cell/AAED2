import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toEnglishDigits } from "@/lib/numberUtils";

const PAGE_SIZES = [10, 20, 30, 50, 100] as const;

interface TablePaginationControlsProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function TablePaginationControls({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
}: TablePaginationControlsProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const from = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const to = Math.min(safePage * pageSize, totalItems);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border px-3 py-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>عدد الصفوف</span>
        <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
          <SelectTrigger className="h-8 w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((size) => (
              <SelectItem key={size} value={String(size)}>{toEnglishDigits(String(size))}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span>
          {toEnglishDigits(String(from))}–{toEnglishDigits(String(to))} من {toEnglishDigits(String(totalItems))}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
        >
          <ChevronRight size={14} /> السابق
        </Button>
        <span className="min-w-20 text-center text-xs text-muted-foreground">
          {toEnglishDigits(String(safePage))} / {toEnglishDigits(String(totalPages))}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
        >
          التالي <ChevronLeft size={14} />
        </Button>
      </div>
    </div>
  );
}
