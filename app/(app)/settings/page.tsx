import TradeLookups from "@/components/settings/TradeLookups";
import GmailSection from "@/components/settings/GmailSection";

// The Gmail callback redirects back here with ?gmail_connected or ?gmail_error,
// so this page reads search params and must not be statically rendered.
export const dynamic = "force-dynamic";

export default function SettingsPage({
  searchParams,
}: {
  searchParams?: { gmail_connected?: string; gmail_error?: string };
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Settings</h1>
      <p className="mb-4 text-sm text-gray-500">
        Manage default trade rates used to auto-fill labour rates on expenses.
      </p>
      <TradeLookups />
      <GmailSection
        connected={searchParams?.gmail_connected}
        errorMessage={searchParams?.gmail_error}
      />
    </div>
  );
}
