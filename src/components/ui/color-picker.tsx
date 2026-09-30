"use client";

import * as React from "react";
import { HexColorPicker } from "react-colorful";
import { Popover, PopoverTrigger, PopoverContent } from "./popover";
import { Input } from "./input";
import { cn } from "@/lib/utils";

export function ColorPicker({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (color: string) => void;
  className?: string;
}) {
  const [local, setLocal] = React.useState(value);
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setLocal(value);
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Pick color"
            className="size-8 shrink-0 rounded-md border border-border-strong shadow-sm transition-transform hover:scale-105"
            style={{ background: value }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto">
          <HexColorPicker color={value} onChange={onChange} />
        </PopoverContent>
      </Popover>
      <Input
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={() => /^#[0-9a-fA-F]{6}$/.test(local) && onChange(local)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && /^#[0-9a-fA-F]{6}$/.test(local)) onChange(local);
        }}
        className="h-8 font-mono text-xs uppercase"
      />
    </div>
  );
}
