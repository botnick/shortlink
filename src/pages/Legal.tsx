import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { useConfig } from "@/lib/config";
import type { ReactNode } from "react";

function Shell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl">
      <Link
        to="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back
      </Link>
      <h1 className="display mt-4 text-3xl">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Last updated: June 2026</p>
      <div className="mt-6 space-y-5 text-sm leading-relaxed text-muted-foreground [&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_strong]:text-foreground">
        {children}
      </div>
    </div>
  );
}

export function Terms() {
  const { config } = useConfig();
  return (
    <Shell title="Terms of Service">
      <p>
        These terms govern your use of {config.appName} (the “service”). By creating an
        account or using the service, you agree to them. If you don’t agree, don’t use the
        service.
      </p>
      <h2>Your account</h2>
      <p>
        You’re responsible for activity under your account and for keeping your password
        secure. Provide accurate information and let us know if you suspect unauthorized
        access.
      </p>
      <h2>Acceptable use</h2>
      <p>
        Don’t use the service to shorten or distribute links to malware, phishing, spam,
        or content that is illegal or infringes others’ rights. We may disable links or
        suspend accounts that break these rules, at our discretion and without notice where
        necessary to protect users.
      </p>
      <h2>Availability</h2>
      <p>
        The service is provided “as is,” without warranties of any kind. We don’t guarantee
        it will be uninterrupted or error-free, and we’re not liable for indirect or
        consequential damages arising from its use, to the extent permitted by law.
      </p>
      <h2>Changes</h2>
      <p>
        We may update these terms. Continued use after a change means you accept the
        updated terms.
      </p>
      <p>
        See also our{" "}
        <Link to="/privacy" className="text-primary hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
    </Shell>
  );
}

export function Privacy() {
  const { config } = useConfig();
  return (
    <Shell title="Privacy Policy">
      <p>
        This policy explains what {config.appName} collects and why. We aim to collect only
        what’s needed to run the service.
      </p>
      <h2>What we collect</h2>
      <p>
        <strong>Account:</strong> your email address and a securely hashed password.
        <br />
        <strong>Links:</strong> the destination URLs, aliases, and titles you create.
        <br />
        <strong>Click analytics:</strong> when someone opens a short link we record the
        time, approximate country, referring site, browser, operating system, device type,
        and the visitor’s IP address. This lets us count visits and show you statistics.
      </p>
      <h2>Cookies</h2>
      <p>
        We use a single, strictly necessary cookie to keep you signed in. We don’t use
        third-party advertising or cross-site tracking.
      </p>
      <h2>How we use it</h2>
      <p>
        To operate the service, show link owners their analytics, and prevent abuse. We
        don’t sell your data. We only share it with the infrastructure providers needed to
        run the service (such as hosting and the database).
      </p>
      <h2>Retention</h2>
      <p>
        Data is kept while your account and links exist. Deleting a link removes its
        analytics; deleting your account removes your data.
      </p>
      <h2>Your choices</h2>
      <p>
        You can edit or delete your links and account at any time. For any data request,
        contact the operator of this instance.
      </p>
      <h2>Changes</h2>
      <p>We may update this policy; the date above reflects the latest version.</p>
      <p>
        See also our{" "}
        <Link to="/terms" className="text-primary hover:underline">
          Terms of Service
        </Link>
        .
      </p>
    </Shell>
  );
}
