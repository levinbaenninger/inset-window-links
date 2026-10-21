import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "@/components/ui/button";

const root = document.querySelector("#root");

if (root) {
  createRoot(root).render(
    <StrictMode>
      <Button>Save</Button>
    </StrictMode>
  );
}
