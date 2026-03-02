"use client";

import { useEffect } from "react";

export default function ScrollToResults() {
  useEffect(() => {
    const el = document.getElementById("habitaciones");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }, []);

  return null;
}
