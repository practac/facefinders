import * as React from "react";

import { cn } from "../../lib/utils";

function Select({ className, ...props }) {
  return <select data-slot="select" className={cn("ui-select", className)} {...props} />;
}

export { Select };
