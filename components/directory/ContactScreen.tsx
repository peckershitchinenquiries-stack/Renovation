"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/fetcher";
import { formatCurrency } from "@/lib/calculations";
import { expiryLabel, expiryTone } from "@/lib/certifications";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState } from "@/components/ui/States";
import { PageHeader, SectionHeader } from "@/components/ui/PageHeader";
import { Sheet } from "@/components/ui/Sheet";
import { StatCard } from "@/components/ui/StatCard";
import { Icon } from "@/components/ui/Icon";
import { DataRow, IconTile, ListCard, ListRow } from "@/components/ui/List";
import { formatDisplayDate } from "@/components/ui/DatePicker";
import { useToast } from "@/components/ui/Toast";
import ContactForm from "@/components/forms/ContactForm";
import CertificationForm from "@/components/forms/CertificationForm";
import type {
  CertificationView,
  ContactBundle,
  TradeLookup,
} from "@/types";

/**
 * One person.
 *
 * The certificates section is at the top, above the work and above the money,
 * and that ordering is the whole design of the screen: a lapsed public
 * liability policy is the only thing here that can stop a job, and it is the
 * only thing nobody thinks to look for.
 */
export default function ContactScreen({
  bundle,
  trades,
  suppliers,
}: {
  bundle: ContactBundle;
  trades: TradeLookup[];
  suppliers: { id: string; name: string }[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { contact, certifications, tasks } = bundle;

  const [editing, setEditing] = useState(false);
  const [addingCert, setAddingCert] = useState(false);
  const [editingCert, setEditingCert] = useState<CertificationView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingCert, setDeletingCert] = useState<CertificationView | null>(
    null
  );

  const worst = certifications.find(
    (c) => c.state === "expired" || c.state === "expiring_soon"
  );

  async function removeContact() {
    try {
      await apiFetch(`/api/contacts/${contact.id}`, { method: "DELETE" });
      toast("Removed from the register", "success");
      router.push("/directory?view=people");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove", "error");
    } finally {
      setDeleting(false);
    }
  }

  async function removeCert(cert: CertificationView) {
    try {
      await apiFetch(`/api/contacts/${contact.id}/certifications/${cert.id}`, {
        method: "DELETE",
      });
      toast("Certificate removed", "success");
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not remove", "error");
    } finally {
      setDeletingCert(null);
    }
  }

  return (
    <div>
      <PageHeader
        title={contact.name}
        subtitle={
          [
            contact.trades.join(", ") || null,
            contact.company,
            contact.status === "inactive" ? "Inactive" : null,
          ]
            .filter(Boolean)
            .join(" · ") || "In the trades register"
        }
        backHref="/directory?view=people"
        backLabel="All people"
        action={
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit"
            className="btn-icon text-gray-600"
          >
            <Icon name="edit" size={19} />
          </button>
        }
      />

      <div className="space-y-5">
        {/* The warning first, and worded as an instruction rather than a
            status. A compliance date only matters at the moment somebody could
            still do something about it. */}
        {worst ? (
          <div
            className={`rounded-2xl p-4 ring-1 ring-inset ${
              worst.state === "expired"
                ? "bg-red-50 text-red-800 ring-red-600/15"
                : "bg-amber-50 text-amber-900 ring-amber-600/20"
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-bold">
              <Icon name="alert" size={17} />
              {worst.state === "expired"
                ? `${worst.kind} has expired`
                : `${worst.kind} expires in ${worst.days_remaining} days`}
            </p>
            <p className="mt-1 text-[0.8125rem] leading-relaxed">
              {worst.expires_on ? formatDisplayDate(worst.expires_on) : ""}
              {worst.reference ? ` · ${worst.reference}` : ""}. Ask for the
              renewal before they are next on site.
            </p>
          </div>
        ) : null}

        {/* Contact details, as a read-only list rather than a form. Tapping a
            phone number should ring it, which is why these are real links. */}
        <ListCard>
          {contact.phone ? (
            <ListRow
              href={`tel:${contact.phone.replace(/\s+/g, "")}`}
              icon="info"
              title={contact.phone}
              subtitle="Phone"
              chevron={false}
            />
          ) : null}
          {contact.email ? (
            <ListRow
              href={`mailto:${contact.email}`}
              icon="mail"
              title={contact.email}
              subtitle="Email"
              chevron={false}
            />
          ) : null}
          {contact.address ? (
            <ListRow
              icon="home"
              title={contact.address}
              subtitle="Address"
              chevron={false}
            />
          ) : null}
          {bundle.supplier_name ? (
            <ListRow
              href={`/directory?view=suppliers`}
              icon="store"
              title={bundle.supplier_name}
              subtitle="Also invoices as this supplier"
            />
          ) : null}
          {!contact.phone && !contact.email && !contact.address ? (
            <div className="px-4 py-6 text-center text-sm text-gray-500">
              No contact details recorded yet.
            </div>
          ) : null}
        </ListCard>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <StatCard
            icon="wallet"
            label="Day rate"
            value={
              contact.day_rate === null
                ? "—"
                : formatCurrency(Number(contact.day_rate))
            }
            hint={contact.day_rate === null ? "None on file" : undefined}
          />
          <StatCard
            icon="clock"
            label="Hourly rate"
            value={
              contact.hourly_rate === null
                ? "—"
                : formatCurrency(Number(contact.hourly_rate))
            }
          />
          <StatCard icon="hammer" label="Tasks" value={String(tasks.length)} />
          <StatCard
            icon="receipt"
            label="Labour, ex-VAT"
            value={formatCurrency(bundle.labour_net)}
            hint={
              bundle.labour_line_count === 0
                ? "No matching lines"
                : `${bundle.labour_line_count} lines, matched by name`
            }
          />
        </div>
        {bundle.labour_line_count > 0 ? (
          <p className="hint -mt-3">
            Labour is matched on the <strong>name written on the invoice
            line</strong>, because that is how it has always been recorded —
            nothing retro-tags the history when somebody is added to the
            register. Treat it as approximate.
          </p>
        ) : null}

        {/* ---- certificates ---- */}
        <section>
          <SectionHeader
            title="Certificates"
            hint="Insurance and qualifications, with the dates that matter"
            action={
              <button
                type="button"
                onClick={() => setAddingCert(true)}
                className="btn btn-secondary btn-sm"
              >
                <Icon name="plus" size={15} />
                Add
              </button>
            }
          />
          {certifications.length === 0 ? (
            <EmptyState
              compact
              icon="check"
              title="None recorded"
              description="Public liability, Gas Safe, NICEIC — record the expiry date and the dashboard warns you 30 days before it lapses."
            />
          ) : (
            <ListCard>
              {certifications.map((cert) => (
                <ListRow
                  key={cert.id}
                  onClick={() => setEditingCert(cert)}
                  leading={
                    <IconTile
                      name={cert.state === "expired" ? "alert" : "check"}
                      tone={
                        cert.state === "expired"
                          ? "bad"
                          : cert.state === "expiring_soon"
                            ? "warn"
                            : cert.state === "unknown"
                              ? "neutral"
                              : "good"
                      }
                    />
                  }
                  title={cert.kind}
                  subtitle={
                    [
                      cert.reference,
                      cert.expires_on
                        ? `Expires ${formatDisplayDate(cert.expires_on)}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "No dates recorded"
                  }
                  meta={
                    <Badge
                      label={expiryLabel(cert.state, cert.days_remaining)}
                      tone={expiryTone(cert.state)}
                    />
                  }
                  chevron={false}
                />
              ))}
            </ListCard>
          )}
        </section>

        {/* ---- work assigned ---- */}
        <section>
          <SectionHeader
            title="Assigned work"
            hint="Across every project"
          />
          {tasks.length === 0 ? (
            <EmptyState
              compact
              icon="list"
              title="Nothing assigned"
              description="Pick this person as the assignee on a task in a project's Schedule tab."
            />
          ) : (
            <ListCard>
              {tasks.map(({ task, project_id, project_name }) => (
                <ListRow
                  key={task.id}
                  href={`/projects/${project_id}?tab=schedule`}
                  icon="hammer"
                  iconTone={task.status === "Complete" ? "good" : "brand"}
                  title={task.name}
                  subtitle={
                    [
                      project_name,
                      task.trade,
                      task.planned_start
                        ? formatDisplayDate(task.planned_start)
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }
                  meta={<Badge label={task.status} />}
                />
              ))}
            </ListCard>
          )}
        </section>

        {contact.notes ? (
          <section>
            <SectionHeader title="Notes" />
            <div className="card">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
                {contact.notes}
              </p>
            </div>
          </section>
        ) : null}

        {/* Removal is last and quiet. Marking somebody inactive is almost
            always what is actually wanted, so the button says so. */}
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setDeleting(true)}
            className="btn btn-danger-soft btn-sm"
          >
            <Icon name="trash" size={15} />
            Remove from register
          </button>
          <p className="hint mt-1.5">
            Their certificates go too. The work, the snags and the log entries
            with their name on stay. If they have simply finished on this job,
            set them <strong>inactive</strong> instead.
          </p>
        </div>
      </div>

      <Sheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit details"
        size="lg"
      >
        <ContactForm
          contact={contact}
          trades={trades}
          suppliers={suppliers}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
          onCancel={() => setEditing(false)}
        />
      </Sheet>

      <Sheet
        open={addingCert || editingCert !== null}
        onClose={() => {
          setAddingCert(false);
          setEditingCert(null);
        }}
        title={editingCert ? "Edit certificate" : "Record a certificate"}
        size="md"
        footer={
          editingCert ? (
            <button
              type="button"
              onClick={() => {
                const cert = editingCert;
                setEditingCert(null);
                setDeletingCert(cert);
              }}
              className="btn btn-danger-soft btn-sm"
            >
              <Icon name="trash" size={15} />
              Remove this certificate
            </button>
          ) : undefined
        }
      >
        <CertificationForm
          contactId={contact.id}
          certification={editingCert ?? undefined}
          onSaved={() => {
            setAddingCert(false);
            setEditingCert(null);
            router.refresh();
          }}
          onCancel={() => {
            setAddingCert(false);
            setEditingCert(null);
          }}
        />
      </Sheet>

      <ConfirmDialog
        open={deleting}
        title="Remove from the register?"
        message={`${contact.name}'s certificates will be deleted with them. Their tasks, snags and log entries stay.`}
        confirmLabel="Remove"
        danger
        onConfirm={removeContact}
        onCancel={() => setDeleting(false)}
      />

      <ConfirmDialog
        open={deletingCert !== null}
        title="Remove this certificate?"
        message={`${deletingCert?.kind ?? ""} will be deleted from ${contact.name}'s record.`}
        confirmLabel="Remove"
        danger
        onConfirm={() => deletingCert && removeCert(deletingCert)}
        onCancel={() => setDeletingCert(null)}
      />
    </div>
  );
}
