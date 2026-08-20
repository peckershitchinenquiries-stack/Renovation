"use client";

import { useRouter } from "next/navigation";
import ExpenseForm from "@/components/forms/ExpenseForm";
import type { ExpenseEntry, InvoiceLineView, TradeLookup } from "@/types";

// Full-screen Add Expense panel (mobile route /projects/[id]/expenses/new).
export default function AddExpensePanel({
  projectId,
  trades,
  nextWeek,
  priorEntries,
  invoiceLines,
}: {
  projectId: string;
  trades: TradeLookup[];
  nextWeek: number;
  priorEntries: ExpenseEntry[];
  invoiceLines: InvoiceLineView[];
}) {
  const router = useRouter();
  const back = () => {
    router.push(`/projects/${projectId}`);
    router.refresh();
  };
  return (
    <ExpenseForm
      projectId={projectId}
      trades={trades}
      nextWeek={nextWeek}
      priorEntries={priorEntries}
      invoiceLines={invoiceLines}
      onSaved={back}
      onCancel={back}
    />
  );
}
