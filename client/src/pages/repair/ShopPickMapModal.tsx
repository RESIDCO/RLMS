/**
 * Modal shop map picker for Bad Orders — click a pin to select.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import ShopMap, { type CatalogItem, type ShopMapPin } from "./ShopMap";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dark: boolean;
  onSelect: (shopId: string, pin: ShopMapPin) => void;
};

export default function ShopPickMapModal({
  open,
  onOpenChange,
  dark,
  onSelect,
}: Props) {
  const [capabilities, setCapabilities] = useState<CatalogItem[]>([]);
  const [carTypes, setCarTypes] = useState<CatalogItem[]>([]);

  useEffect(() => {
    if (!open) return;
    Promise.all([
      apiRequest("GET", "/api/repair/admin/shop-catalog/capability").then((r) =>
        r.json(),
      ),
      apiRequest("GET", "/api/repair/admin/shop-catalog/car_type").then((r) =>
        r.json(),
      ),
    ])
      .then(([caps, types]) => {
        setCapabilities(caps.items ?? caps.rows ?? caps ?? []);
        setCarTypes(types.items ?? types.rows ?? types ?? []);
      })
      .catch(() => undefined);
  }, [open]);

  const panel = dark
    ? "bg-slate-900/60 border-slate-700"
    : "bg-slate-50 border-slate-200";
  const input = dark
    ? "h-8 bg-slate-950 border-slate-600 text-slate-100 rounded-md border px-2 text-xs"
    : "h-8 bg-white border-slate-300 rounded-md border px-2 text-xs";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-[min(96vw,56rem)] p-4">
        <DialogHeader>
          <DialogTitle className="text-base">Pick shop on map</DialogTitle>
        </DialogHeader>
        {open && (
          <ShopMap
            dark={dark}
            activeOnly
            capabilities={capabilities}
            carTypes={carTypes}
            panelClass={panel}
            inputClass={input}
            height="min(55vh, 480px)"
            hideFilters={false}
            onSelectShop={(pin) => {
              onSelect(pin.id, pin);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
