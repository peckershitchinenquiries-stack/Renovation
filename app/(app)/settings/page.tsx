import TradeLookups from "@/components/settings/TradeLookups";
import GmailSection from "@/components/settings/GmailSection";
import { SignOutButton } from "@/components/ui/SignOutButton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";

// The Gmail callback redirects back here with ?gmail_connected or ?gmail_error,
// so this page reads search params and must not be statically rendered.
export const dynamic = "force-dynamic";

export default function SettingsPage({
  searchParams,
}: {
  searchParams?: {
    gmail_connected?: string;
    gmail_error?: string;
    // Set by the callback when the credential saved but the watch did not
    // register — connected, but nothing will arrive until it is retried.
    watch?: string;
    watch_error?: string;
  };
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" flush />

      <div className="space-y-6">
        <TradeLookups />
        <GmailSection
          connected={searchParams?.gmail_connected}
          errorMessage={searchParams?.gmail_error}
          watchFailed={searchParams?.watch === "failed"}
          watchError={searchParams?.watch_error}
        />

        {/*
          Sign out has a home on mobile for the first time. It used to live only
          in the drawer that the bottom tab bar replaced, and in the desktop top
          bar — so on a phone there was no way out of the app at all once the
          drawer went.
        */}
        <section>
          <SignOutButton className="btn-danger-soft w-full justify-center" />
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-gray-400">
            <Icon name="info" size={13} />
            Accounts are created by the project owner.
          </p>
        </section>
      </div>
    </div>
  );
}
