"use client";

import ThermalAutoPrint from "@/app/admin/components/ThermalAutoPrint";

type ReceiptAutoPrintProps = {
  nextUrl?: string;
  closeOnDone?: boolean;
};

export default function ReceiptAutoPrint(props: ReceiptAutoPrintProps) {
  return <ThermalAutoPrint {...props} />;
}
