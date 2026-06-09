import { Link } from "react-router-dom";
import { FileText, ShieldCheck } from "lucide-react";
import { useConfig } from "@/lib/config";
import { BackLink } from "@/components/BackLink";
import type { ReactNode } from "react";

function Shell({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-2xl py-2">
      <BackLink to="/" label="Back home" />

      <div className="mt-6 flex items-center gap-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icon}
        </span>
        <div>
          <h1 className="display text-3xl leading-none">{title}</h1>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Last updated · June 2026
          </p>
        </div>
      </div>

      <div className="mt-8 space-y-5 border-t pt-8 text-[15px] leading-7 text-muted-foreground [&_a]:font-medium [&_a]:text-primary hover:[&_a]:underline [&_h2]:mt-7 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight [&_h2]:text-foreground [&_li]:pl-1 [&_p]:max-w-prose [&_strong]:font-semibold [&_strong]:text-foreground [&_ul]:max-w-prose [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </div>
  );
}

export function Terms() {
  const { config } = useConfig();
  const app = config.appName;
  return (
    <Shell title="Terms of Service" icon={<FileText className="size-5" />}>
      <p>
        These Terms govern your use of {app} (the “Service”), operated by the operator of this
        instance. By creating an account or using the Service, you agree to them. If you don’t
        agree, don’t use the Service.
      </p>

      <h2>Your account</h2>
      <p>
        You’re responsible for activity under your account and for keeping your credentials
        secure. Provide accurate information and tell us about any unauthorized access. We may
        suspend or close accounts that break these Terms.
      </p>

      <h2>Acceptable use</h2>
      <p>
        <strong>You are solely responsible for the links you create and the destinations they
        point to.</strong> Don’t use the Service for anything that is illegal or links to:
      </p>
      <ul>
        <li>malware, phishing, or deceptive content;</li>
        <li>spam or fraudulent schemes;</li>
        <li>content that infringes intellectual‑property, privacy, or other rights;</li>
        <li>material that exploits minors, or harassment, threats, or hate speech;</li>
        <li>anything prohibited where you or your audience are located, or that hides the destination to evade security filters.</li>
      </ul>

      <h2>Your links</h2>
      <p>
        You keep ownership of your URLs and metadata and grant us a limited licence to store and
        serve them to run the Service. You warrant that each destination is lawful and that you
        have the right to share it. We don’t control, endorse, or take responsibility for
        destinations or third‑party sites, and we may disable links, remove content, or disclose
        information to law enforcement where appropriate.
      </p>

      <h2>Warranty &amp; liability</h2>
      <p>
        The Service is provided “as is”, without warranties of any kind. To the maximum extent
        permitted by law, we are not liable for indirect or consequential damages, and our total
        liability is limited. <strong>You agree to indemnify us against any claim arising from
        your use, your links, or your breach of these Terms or any law — you are solely
        responsible for any unlawful use you make of the Service.</strong>
      </p>

      <h2>Termination &amp; changes</h2>
      <p>
        You can delete your account at any time; we may suspend access for violations. We may
        update these Terms, and continued use means you accept the changes. These Terms follow
        the operator’s local law; if any part is unenforceable, the rest still applies.
      </p>

      <p>
        See also our <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </Shell>
  );
}

export function Privacy() {
  const { config } = useConfig();
  const app = config.appName;
  return (
    <Shell title="Privacy Policy" icon={<ShieldCheck className="size-5" />}>
      <p>
        This policy explains what {app} (operated by the operator of this instance) collects and
        why. We collect only what’s needed to run the Service.
      </p>

      <h2>What we collect</h2>
      <p>
        <strong>Account:</strong> your email and a securely hashed password.
        <br />
        <strong>Links:</strong> the destination URLs, aliases, and titles you create.
        <br />
        <strong>Click analytics:</strong> when a short link is opened we record the time,
        approximate country, referring site, browser, OS, device type, and the visitor’s IP
        address — to count visits and show link owners their statistics.
      </p>

      <h2>How we use it</h2>
      <p>
        To run and secure the Service, show owners their analytics, and prevent abuse. We don’t
        sell your data or use it for advertising or cross‑site tracking. We share it only with
        the infrastructure providers needed to run the Service, and where required by law.
      </p>

      <h2>Cookies</h2>
      <p>
        We use a single, strictly necessary cookie to keep you signed in — no advertising or
        tracking cookies.
      </p>

      <h2>Retention &amp; your rights</h2>
      <p>
        Data is kept while your account and links exist. Deleting a link removes its analytics;
        deleting your account removes your data, subject to backups and legal requirements. You
        can edit or delete your links and account anytime, or contact the operator of this
        instance to access, export, or delete your data.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy; the date above reflects the latest version. For any privacy
        question, contact the operator of this instance.
      </p>

      <p>
        See also our <Link to="/terms">Terms of Service</Link>.
      </p>
    </Shell>
  );
}
