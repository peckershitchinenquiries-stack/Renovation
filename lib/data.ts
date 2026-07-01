// Server-side data loaders — fetch a project + its computed entries once and reuse.
import { createClient } from "@/lib/supabase/server";
import { computeEntries } from "@/lib/calculations";
import type {
  Project,
  ExpenseEntry,
  ExpenseEntryComputed,
  TradeLookup,
  ProjectWeek,
} from "@/types";

export async function getProject(id: string): Promise<Project | null> {
  const supabase = createClient();
  const { data } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  return (data as Project) ?? null;
}

export async function getProjectBundle(id: string): Promise<{
  project: Project;
  entries: ExpenseEntryComputed[];
  lookups: TradeLookup[];
  weeks: ProjectWeek[];
} | null> {
  const supabase = createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single();
  if (!project) return null;

  const [{ data: rawEntries }, { data: lookups }, { data: weeks }] =
    await Promise.all([
      supabase
        .from("expense_entries")
        .select("*")
        .eq("project_id", id)
        .order("week_number", { ascending: true }),
      supabase.from("trade_lookups").select("*"),
      supabase.from("project_weeks").select("*").eq("project_id", id),
    ]);

  return {
    project: project as Project,
    entries: computeEntries((rawEntries ?? []) as ExpenseEntry[]),
    lookups: (lookups ?? []) as TradeLookup[],
    weeks: (weeks ?? []) as ProjectWeek[],
  };
}
