"use client";

import { useRouter } from "next/navigation";
import ExpenseForm from "@/components/forms/ExpenseForm";
import type { ExpenseEntry, TradeLookup } from "@/types";

// Full-screen Add Expense panel (mobile route /projects/[id]/expenses/new).
export default function AddExpensePanel({
  projectId,
  trades,
  nextWeek,
  priorEntries,
}: {
  projectId: string;
  trades: TradeLookup[];
  nextWeek: number;
  priorEntries: ExpenseEntry[];
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
      onSaved={back}
      onCancel={back}
    />
  );
}
