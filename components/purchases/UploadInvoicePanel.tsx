"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { createClient } from "@/lib/supabase/client";
import { Spinner } from "@/components/ui/States";
import type { InvoiceUpload } from "@/types";

// Step 1 of invoice ingestion, from the browser's side: get a file into
// Storage and through extraction, with an honest status the whole way. It
// hands off to /invoices/[uploadId]/review.
//
// Per file: POST /api/invoices/upload-url -> PUT straight to the signed url
// -> POST /api/invoices/[id]/extract. The file itself never passes through a
// Next.js route (about.md's Vercel 4.5MB body cap is why).
//
// No project is involved at any point here. Since migration 0012 an upload
// carries no project until the review screen files it against one, which is
// what lets this panel live in the nav bar rather than inside a project.

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const ACCEPT = ALLOWED_TYPES.join(",");
const MAX_BYTES = 20 * 1024 * 1024; // mirrors app/api/invoices/upload-url/route.ts

type ItemPhase = "uploading" | "processing" | "extracted" | "failed";

interface QueueItem {
  key: string;
  file: File;
  phase: ItemPhase;
  progress: number; // 0-1, only meaningful while phase === "uploading"
  uploadId: string | null;
  uploadUrl: string | null;
  uploaded: boolean; // true once the PUT to storage has actually succeeded
  error: string | null;
}

let seq = 0;
const nextKey = () => `upload-${(seq += 1)}`;

function validate(file: File): string | null {
  if (!ALLOWED_TYPES.includes(file.type))
    return "Unsupported file type. Use JPG, PNG, WebP or PDF.";
  if (file.size > MAX_BYTES) return "File exceeds the 20MB limit.";
  return null;
}

// Same request shape createSignedUploadUrl's own SDK method makes, done by
// hand so upload progress can be reported — the SDK's own upload has none.
function uploadFileToSignedUrl(
  url: string,
  file: File,
  onProgress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url, true);
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (anonKey) xhr.setRequestHeader("apikey", anonKey);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection"));
    const body = new FormData();
    body.append("cacheControl", "3600");
    body.append("", file);
    xhr.send(body);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function UploadInvoicePanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const itemsRef = useRef<QueueItem[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const supabaseRef = useRef(createClient());
  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const channels = useRef<Map<string, RealtimeChannel>>(new Map());

  useEffect(() => {
    const timers = pollTimers.current;
    const chans = channels.current;
    const supabase = supabaseRef.current;
    return () => {
      timers.forEach((t) => clearInterval(t));
      chans.forEach((c) => supabase.removeChannel(c));
    };
  }, []);

  const patchItem = useCallback((key: string, patch: Partial<QueueItem>) => {
    setItems((current) =>
      current.map((it) => (it.key === key ? { ...it, ...patch } : it))
    );
  }, []);

  const stopWatching = useCallback((uploadId: string) => {
    const timer = pollTimers.current.get(uploadId);
    if (timer) {
      clearInterval(timer);
      pollTimers.current.delete(uploadId);
    }
    const channel = channels.current.get(uploadId);
    if (channel) {
      supabaseRef.current.removeChannel(channel);
      channels.current.delete(uploadId);
    }
  }, []);

  // Applies whatever the server currently says about one row. Called from
  // both the polling fallback and the Realtime subscription — and from the
  // extract POST's own response — so all three paths converge on the same
  // terminal state instead of racing each other.
  const applyServerStatus = useCallback(
    (key: string, uploadId: string, row: { status: InvoiceUpload["status"]; error: InvoiceUpload["error"] }) => {
      if (row.status === "extracted") {
        patchItem(key, { phase: "extracted", error: null });
        stopWatching(uploadId);
      } else if (row.status === "failed") {
        patchItem(key, {
          phase: "failed",
          error: row.error ?? "Extraction failed for an unknown reason.",
        });
        stopWatching(uploadId);
      } else if (row.status === "committed") {
        stopWatching(uploadId);
      }
      // 'pending' / 'processing' — the local phase already says as much.
    },
    [patchItem, stopWatching]
  );

  // Realtime is the primary signal; a poll runs alongside it from the start
  // and only backs off (rather than stopping outright) once Realtime proves
  // it connected, so a missed message still lands eventually.
  const watchUpload = useCallback(
    (key: string, uploadId: string) => {
      const poll = () => {
        apiFetch<{ upload: InvoiceUpload }>(`/api/invoices/${uploadId}`)
          .then((res) => applyServerStatus(key, uploadId, res.upload))
          .catch(() => {
            // Transient network hiccup — the next poll or Realtime message
            // will catch up. Nothing to show the user for a single miss.
          });
      };
      pollTimers.current.set(uploadId, setInterval(poll, 4000));

      const channel = supabaseRef.current
        .channel(`invoice_upload_${uploadId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "invoice_uploads",
            filter: `id=eq.${uploadId}`,
          },
          (payload: RealtimePostgresChangesPayload<InvoiceUpload>) => {
            const next = payload.new as InvoiceUpload;
            if (next.status) applyServerStatus(key, uploadId, next);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            const timer = pollTimers.current.get(uploadId);
            if (timer) {
              clearInterval(timer);
              pollTimers.current.set(uploadId, setInterval(poll, 15000));
            }
          }
        });
      channels.current.set(uploadId, channel);
    },
    [applyServerStatus]
  );

  // Drives one item through its whole lifecycle. Resumable: if uploadId /
  // uploadUrl / uploaded are already set on the item (a retry), it picks up
  // from wherever it actually got to rather than starting over blind.
  const runUpload = useCallback(
    async (start: QueueItem) => {
      const { key, file } = start;
      try {
        let uploadId = start.uploadId;
        let uploadUrl = start.uploadUrl;
        let uploaded = start.uploaded;

        if (!uploadId) {
          patchItem(key, { phase: "uploading", error: null, progress: 0 });
          const created = await apiFetch<{ id: string; upload_url: string }>(
            "/api/invoices/upload-url",
            {
              method: "POST",
              body: JSON.stringify({
                // No project: which job this invoice belongs to is decided on
                // the review screen, once you can see the document
                // (migration 0012).
                filename: file.name,
                mime_type: file.type,
                file_size: file.size,
              }),
            }
          );
          uploadId = created.id;
          uploadUrl = created.upload_url;
          patchItem(key, { uploadId, uploadUrl });
        }

        if (!uploaded) {
          patchItem(key, { phase: "uploading", error: null });
          await uploadFileToSignedUrl(uploadUrl!, file, (fraction) =>
            patchItem(key, { progress: fraction })
          );
          uploaded = true;
          patchItem(key, { uploaded: true, progress: 1 });
        }

        patchItem(key, { phase: "processing", error: null });
        watchUpload(key, uploadId);

        const extracted = await apiFetch<{ upload: InvoiceUpload }>(
          `/api/invoices/${uploadId}/extract`,
          { method: "POST" }
        );
        applyServerStatus(key, uploadId, extracted.upload);
      } catch (err) {
        const message =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : "Something went wrong";
        patchItem(key, { phase: "failed", error: message });
      }
    },
    [patchItem, watchUpload, applyServerStatus]
  );

  const enqueueFiles = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      for (const file of list) {
        const key = nextKey();
        const validationError = validate(file);
        const item: QueueItem = {
          key,
          file,
          phase: validationError ? "failed" : "uploading",
          progress: 0,
          uploadId: null,
          uploadUrl: null,
          uploaded: false,
          error: validationError,
        };
        setItems((current) => [item, ...current]);
        if (!validationError) void runUpload(item);
      }
    },
    [runUpload]
  );

  const retry = useCallback(
    (key: string) => {
      const current = itemsRef.current.find((it) => it.key === key);
      if (!current) return;
      void runUpload(current);
    },
    [runUpload]
  );

  const remove = useCallback((key: string) => {
    const current = itemsRef.current.find((it) => it.key === key);
    if (current?.uploadId) stopWatching(current.uploadId);
    setItems((prev) => prev.filter((it) => it.key !== key));
  }, [stopWatching]);

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length) enqueueFiles(e.dataTransfer.files);
  }

  return (
    <div className="space-y-4">
      <div
        className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition ${
          dragOver ? "border-brand bg-brand-50" : "border-gray-300 bg-white"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <span className="text-3xl" aria-hidden>
          📄
        </span>
        <p className="mt-2 text-sm font-medium text-gray-900">
          Drag invoices here, or choose files
        </p>
        <p className="mt-1 text-xs text-gray-500">
          JPG, PNG, WebP or PDF, up to 20MB each. You can add several at once.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            className="btn-primary"
            onClick={() => inputRef.current?.click()}
          >
            Choose files
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => cameraInputRef.current?.click()}
          >
            Take a photo
          </button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          aria-label="Choose invoice files"
          onChange={(e) => {
            if (e.target.files?.length) enqueueFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          aria-label="Photograph an invoice"
          onChange={(e) => {
            if (e.target.files?.length) enqueueFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <UploadRow
              key={item.key}
              item={item}
              onRetry={() => retry(item.key)}
              onRemove={() => remove(item.key)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function UploadRow({
  item,
  onRetry,
  onRemove,
}: {
  item: QueueItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">
            {item.file.name}
          </p>
          <p className="text-xs text-gray-500">{formatBytes(item.file.size)}</p>
        </div>
        <StatusBadge phase={item.phase} />
      </div>

      {item.phase === "uploading" && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full bg-brand transition-all"
            style={{ width: `${Math.round(item.progress * 100)}%` }}
          />
        </div>
      )}

      {item.phase === "processing" && (
        <p className="mt-2 flex items-center gap-2 text-xs text-gray-500">
          <Spinner />
          Reading the invoice — this can take up to a minute.
        </p>
      )}

      {item.phase === "extracted" && item.uploadId && (
        <div className="mt-2 flex items-center justify-between">
          <p className="text-xs text-emerald-700">Read successfully.</p>
          <Link
            href={`/invoices/${item.uploadId}/review`}
            className="btn-secondary"
          >
            Review
          </Link>
        </div>
      )}

      {item.phase === "failed" && (
        <div className="mt-2">
          <p className="field-warning">{item.error}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={onRetry}>
              Retry
            </button>
            <Link href="/invoices/new" className="btn-secondary">
              Enter manually instead
            </Link>
            <button
              type="button"
              className="text-xs text-gray-400 hover:text-gray-600"
              onClick={onRemove}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ phase }: { phase: ItemPhase }) {
  const LABEL: Record<ItemPhase, string> = {
    uploading: "Uploading",
    processing: "Processing",
    extracted: "Extracted",
    failed: "Failed",
  };
  const STYLE: Record<ItemPhase, string> = {
    uploading: "bg-blue-100 text-blue-800",
    processing: "bg-amber-100 text-amber-800",
    extracted: "bg-emerald-100 text-emerald-800",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STYLE[phase]}`}
    >
      {LABEL[phase]}
    </span>
  );
}
