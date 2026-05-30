import type { ReactNode } from "react";

import { Button } from "../../../app/components/ui/button";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../../../app/components/ui/drawer";
import { cn } from "../../../app/components/ui/utils";
import type { DrawerWidth } from "../types";

const widthClassName: Record<DrawerWidth, string> = {
  narrow: "!w-[60vw] !min-w-[60vw] max-w-[calc(100vw-24px)]",
  medium: "!w-[60vw] !min-w-[60vw] max-w-[calc(100vw-24px)]",
  wide: "!w-[60vw] !min-w-[60vw] max-w-[calc(100vw-24px)]",
};

export function DrawerShell({
  open,
  title,
  description,
  width = "medium",
  dirty = false,
  footer,
  children,
  onOpenChange,
}: {
  open: boolean;
  title: string;
  description?: string;
  width?: DrawerWidth;
  dirty?: boolean;
  footer?: ReactNode;
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      open={open}
      direction="right"
      onOpenChange={(nextOpen) => {
        if (!nextOpen && dirty && !window.confirm("当前有未保存修改，确认关闭吗？")) {
          return;
        }
        onOpenChange(nextOpen);
      }}
    >
      <DrawerContent className={cn("bg-white sm:!max-w-none", widthClassName[width])}>
        <DrawerHeader className="border-b border-slate-200 px-5 py-4">
          <DrawerTitle className="text-lg font-bold text-slate-950">{title}</DrawerTitle>
          {description ? <DrawerDescription>{description}</DrawerDescription> : null}
        </DrawerHeader>
        <div className="material-scrollbar flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? (
          <DrawerFooter className="border-t border-slate-200 px-5 py-4">{footer}</DrawerFooter>
        ) : (
          <DrawerFooter className="border-t border-slate-200 px-5 py-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
          </DrawerFooter>
        )}
      </DrawerContent>
    </Drawer>
  );
}
