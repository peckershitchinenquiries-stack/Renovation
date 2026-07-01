import TradeLookups from "@/components/settings/TradeLookups";

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Settings</h1>
      <p className="mb-4 text-sm text-gray-500">
        Manage default trade rates used to auto-fill labour rates on expenses.
      </p>
      <TradeLookups />
    </div>
  );
}
