import * as React from "react";

import { cn } from "../../lib/utils";

function Tabs({ className, ...props }) {
  return <div data-slot="tabs" className={cn("ui-tabs", className)} {...props} />;
}

function TabsList({ className, ...props }) {
  return <div data-slot="tabs-list" className={cn("ui-tabs-list", className)} {...props} />;
}

function TabsTrigger({ className, active = false, ...props }) {
  return (
    <button
      data-slot="tabs-trigger"
      data-state={active ? "active" : "inactive"}
      className={cn("ui-tabs-trigger", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger };
