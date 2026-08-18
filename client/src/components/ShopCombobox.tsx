import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export type ShopOption = { id: number; name: string };

export default function ShopCombobox({
  shops,
  value,
  onChange,
  disabled,
  compact,
}: {
  shops: ShopOption[];
  value: number | null;
  onChange: (shopId: number | null) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = shops.find((s) => s.id === value) ?? null;
  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return shops;
    return shops.filter((s) => s.name.toLowerCase().includes(n));
  }, [shops, q]);
  const exact = shops.some((s) => s.name.trim().toLowerCase() === q.trim().toLowerCase());

  const create = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/programs/shops", { name });
      return res.json() as Promise<ShopOption>;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ["/api/programs/shops"] });
      onChange(row.id);
      setOpen(false);
      setQ("");
    },
    onError: (e: Error) => toast({ title: "Could not add shop", description: e.message, variant: "destructive" }),
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className={cn("justify-between font-normal", compact ? "h-7 px-2 text-xs max-w-[180px]" : "h-9 w-full")}
        >
          <span className="truncate">{selected?.name ?? "—"}</span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[260px]" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type a shop name…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>No shops yet — type a name to add one.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                  setQ("");
                }}
              >
                —
              </CommandItem>
              {filtered.map((s) => (
                <CommandItem
                  key={s.id}
                  value={`${s.id}-${s.name}`}
                  onSelect={() => {
                    onChange(s.id);
                    setOpen(false);
                    setQ("");
                  }}
                >
                  {s.name}
                </CommandItem>
              ))}
              {q.trim() && !exact && (
                <CommandItem
                  value={`__add__${q}`}
                  onSelect={() => create.mutate(q.trim())}
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add “{q.trim()}” as a new shop
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
