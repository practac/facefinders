import * as React from "react";

import { cn } from "../../lib/utils";

function Input({ className, type = "text", ...props }) {
  return <input data-slot="input" type={type} className={cn("ui-input", className)} {...props} />;
}

export { Input };
