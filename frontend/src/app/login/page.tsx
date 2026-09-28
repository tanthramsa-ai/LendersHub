'use client';

import { FormEvent, useEffect, useState } from "react";
import { ArrowRight, Building2, Shield } from "lucide-react";
import Link from "next/link";
import { AuthShell } from "@/components/AuthShell";

const WORKSPACE_KEY = "lh_last_workspace";
const ROOT_DOMAIN = process.env.NEXT_PUBLIC_TENANT_ROOT_DOMAIN;
function workspaceLoginUrl(subdomain: string) {
  return ROOT_DOMAIN ? `https://${subdomain}.${ROOT_DOMAIN}/login` : `/${subdomain}/login`;
}

export default function WorkspaceLogin() {
  const [workspace, setWorkspace] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    try {
      const previous = window.localStorage.getItem(WORKSPACE_KEY);
      // Restore the user's browser preference after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (previous) setWorkspace(previous);
    } catch { /* Storage may be unavailable in private browsing. */ }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = workspace.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) {
      setError("Enter your workspace name to continue.");
      return;
    }
    setError("");
    setLoading(true);
    try { window.localStorage.setItem(WORKSPACE_KEY, slug); } catch {}
    window.location.href = workspaceLoginUrl(slug);
  }

  return (
    <AuthShell eyebrow="Welcome back" title="Find your workspace" description="Enter the workspace name your team uses to access LendersHub.">
      <form className="lh-form" onSubmit={handleSubmit} noValidate>
        <div className="lh-field">
          <label htmlFor="workspace">Workspace</label>
          <div className={`lh-input-wrap ${error ? "is-invalid" : ""}`}>
            <Building2 size={18} aria-hidden="true" />
            <input id="workspace" name="workspace" autoComplete="organization" value={workspace} onChange={(event) => { setWorkspace(event.target.value); setError(""); }} placeholder="e.g. acme" aria-describedby={error ? "workspace-error" : "workspace-help"} aria-invalid={Boolean(error)} autoFocus />
            {ROOT_DOMAIN && <span>.{ROOT_DOMAIN}</span>}
          </div>
          {error ? <p className="lh-field-error" id="workspace-error" role="alert">{error}</p> : <p className="lh-field-help" id="workspace-help">You can find this in the link shared by your administrator.</p>}
        </div>
        <button className="lh-button lh-button--form" type="submit" disabled={loading}>
          {loading ? "Opening workspace…" : "Continue"}<ArrowRight size={18} />
        </button>
      </form>
      <div className="lh-auth__divider"><span>Platform access</span></div>
      <Link href="/super-admin/login" className="lh-admin-link"><Shield size={17} /><span><strong>Platform administrator</strong><small>Sign in to manage LendersHub</small></span><ArrowRight size={17} /></Link>
    </AuthShell>
  );
}
