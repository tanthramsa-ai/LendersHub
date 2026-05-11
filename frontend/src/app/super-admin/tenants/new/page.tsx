'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { sessionStore } from '@/services/super-admin-auth';
import { tenantsApi, type CreateTenantResult } from '@/services/tenants';

// ── Types ─────────────────────────────────────────────────────────────────────

type SubdomainStatus = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

interface PlanOption { id: string; name: string; basePrice: number; popular?: boolean; features: string[] }

// ── Constants ─────────────────────────────────────────────────────────────────

const PLANS: PlanOption[] = [
  { id: 'STARTER',      name: 'Starter',      basePrice: 12000, features: ['Up to 50 users', '5 GB storage', 'Core features', 'Basic support'] },
  { id: 'PROFESSIONAL', name: 'Professional', basePrice: 25000, popular: true, features: ['Up to 200 users', '50 GB storage', 'Advanced features', 'Priority support', 'API access'] },
  { id: 'ENTERPRISE',   name: 'Enterprise',   basePrice: 45000, features: ['Unlimited users', '500 GB storage', 'White-labeling', '24/7 support', 'SLA guarantee'] },
];

const BILLING_OPTIONS = [
  { id: 'MONTHLY',   label: 'Monthly',                    discount: 0 },
  { id: 'QUARTERLY', label: 'Quarterly',  discountLabel: '5% off',  discount: 0.05 },
  { id: 'ANNUALLY',  label: 'Annually',   discountLabel: '15% off', discount: 0.15 },
];

const TRIAL_OPTIONS = [
  { days: 0,  label: 'No Trial' },
  { days: 7,  label: '7 Days Free Trial' },
  { days: 14, label: '14 Days Free Trial' },
  { days: 30, label: '30 Days Free Trial' },
];

const FEATURE_TOGGLES = [
  { key: 'smsNotifications',  label: 'SMS Notifications',   desc: 'Allow sending SMS to customers' },
  { key: 'emailIntegration',  label: 'Email Integration',   desc: 'Enable email notifications and reports' },
  { key: 'multiCurrency',     label: 'Multi-Currency Support', desc: 'Allow loans in multiple currencies' },
  { key: 'apiAccess',         label: 'API Access',          desc: 'Enable REST API for integrations' },
  { key: 'mobileApp',         label: 'Mobile App Access',   desc: 'Allow agents to use mobile app' },
  { key: 'advancedAnalytics', label: 'Advanced Analytics',  desc: 'Enable detailed reports and dashboards' },
];

const INDIAN_STATES = [
  'Andhra Pradesh','Arunachal Pradesh','Assam','Bihar','Chhattisgarh','Goa','Gujarat',
  'Haryana','Himachal Pradesh','Jharkhand','Karnataka','Kerala','Madhya Pradesh',
  'Maharashtra','Manipur','Meghalaya','Mizoram','Nagaland','Odisha','Punjab',
  'Rajasthan','Sikkim','Tamil Nadu','Telangana','Tripura','Uttar Pradesh',
  'Uttarakhand','West Bengal',
  // UTs
  'Delhi','Jammu & Kashmir','Ladakh','Puducherry','Chandigarh',
  'Dadra and Nagar Haveli','Daman and Diu','Lakshadweep','Andaman and Nicobar Islands',
];

const SETUP_FEE = 5000;

// ── Sub-components ─────────────────────────────────────────────────────────────

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:opacity-50 text-sm ${props.className ?? ''}`}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent text-sm ${props.className ?? ''}`}
    />
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3">
        <span className="text-gray-400">{icon}</span>
        <h3 className="font-semibold text-white">{title}</h3>
      </div>
      <div className="p-6 space-y-5">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-violet-600' : 'bg-gray-700'}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform mt-1 ${checked ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  );
}

function CredentialsModal({ result, onClose }: { result: CreateTenantResult; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  function copyPassword() {
    navigator.clipboard.writeText(result.temporaryPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="p-6 border-b border-gray-800 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="font-bold text-white">Tenant Provisioned</h2>
            <p className="text-sm text-gray-400">{result.tenant.companyName} · {result.provisionedInMs}ms</p>
          </div>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-amber-400 bg-amber-950 border border-amber-800 rounded-lg px-4 py-3">
            Save the temporary password now — it will not be shown again.
          </p>
          <div className="space-y-3">
            {[
              { label: 'Subdomain', value: result.tenant.subdomain },
              { label: 'Admin Email', value: result.admin.email },
              { label: 'Login URL', value: result.loginUrl },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between items-center bg-gray-800 rounded-lg px-4 py-2.5">
                <span className="text-xs text-gray-400 w-28 shrink-0">{label}</span>
                <span className="text-sm text-white font-mono break-all text-right">{value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center bg-gray-800 rounded-lg px-4 py-2.5 gap-3">
              <span className="text-xs text-gray-400 w-28 shrink-0">Temp Password</span>
              <span className="text-sm text-emerald-400 font-mono flex-1 text-right">{result.temporaryPassword}</span>
              <button onClick={copyPassword} className="ml-2 shrink-0 text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 transition-colors">
                {copied ? '✓' : 'Copy'}
              </button>
            </div>
          </div>
          {result.emailPreviewUrl && (
            <a href={result.emailPreviewUrl} target="_blank" rel="noopener noreferrer" className="block text-center text-xs text-violet-400 hover:underline">
              Preview welcome email (Ethereal) →
            </a>
          )}
        </div>
        <div className="p-6 border-t border-gray-800 flex gap-3 justify-end">
          <button onClick={() => router.push('/super-admin/tenants')} className="px-4 py-2 text-sm rounded-lg border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 transition-colors">
            View All Tenants
          </button>
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg bg-violet-600 hover:bg-violet-500 text-white font-medium transition-colors">
            Create Another
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function NewTenantPage() {
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Form state
  const [form, setForm] = useState({
    companyName: '', subdomain: '', registrationNumber: '', gstNumber: '',
    address: '', city: '', state: '',
    adminEmail: '', adminFirstName: '', adminLastName: '',
    primaryColor: '#7C3AED', customDomain: '',
  });
  const [features, setFeatures] = useState<Record<string, boolean>>({
    smsNotifications: true, emailIntegration: true, multiCurrency: false,
    apiAccess: true, mobileApp: true, advancedAnalytics: true,
  });
  const [selectedPlan, setSelectedPlan] = useState<string>('PROFESSIONAL');
  const [billing, setBilling] = useState<string>('MONTHLY');
  const [trialDays, setTrialDays] = useState<number>(0);

  const [subdomainStatus, setSubdomainStatus] = useState<SubdomainStatus>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateTenantResult | null>(null);

  useEffect(() => {
    if (!sessionStore.getToken()) router.replace('/super-admin/login');
  }, [router]);

  function set(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function handleSubdomainChange(value: string) {
    const lower = value.toLowerCase().replace(/[^a-z0-9-]/g, '');
    set('subdomain', lower);
    setSubdomainStatus('idle');
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!lower) return;
    const quickValid = /^[a-z0-9]/.test(lower) && lower.length >= 3;
    if (!quickValid) { setSubdomainStatus('invalid'); return; }
    setSubdomainStatus('checking');
    debounceRef.current = setTimeout(async () => {
      try {
        const check = await tenantsApi.checkSubdomain(lower);
        setSubdomainStatus(!check.valid ? 'invalid' : check.available ? 'available' : 'taken');
      } catch { setSubdomainStatus('idle'); }
    }, 500);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (subdomainStatus !== 'available') return;
    setError('');
    setSubmitting(true);
    try {
      const res = await tenantsApi.create({
        ...form,
        gstNumber: form.gstNumber || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        primaryColor: form.primaryColor || undefined,
        customDomain: form.customDomain || undefined,
        features,
        plan: selectedPlan,
        billingCycle: billing,
        trialDays,
      });
      setResult(res);
      // Reset form
      setForm({ companyName: '', subdomain: '', registrationNumber: '', gstNumber: '', address: '', city: '', state: '', adminEmail: '', adminFirstName: '', adminLastName: '', primaryColor: '#7C3AED', customDomain: '' });
      setSubdomainStatus('idle');
      setSelectedPlan('PROFESSIONAL');
      setBilling('MONTHLY');
      setTrialDays(0);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create tenant');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSaveDraft(e: React.MouseEvent) {
    e.preventDefault();
    setError('');
    if (!form.companyName || !form.subdomain || subdomainStatus === 'taken' || subdomainStatus === 'invalid') {
      setError('Company name and a valid subdomain are required to save a draft');
      return;
    }
    setSubmitting(true);
    try {
      const res = await tenantsApi.create({
        companyName: form.companyName,
        subdomain: form.subdomain,
        registrationNumber: form.registrationNumber || 'DRAFT',
        address: form.address || 'Draft',
        adminEmail: form.adminEmail || `draft-${form.subdomain}@placeholder.lendershub.com`,
        adminFirstName: form.adminFirstName || 'Draft',
        adminLastName: form.adminLastName || 'User',
        city: form.city || undefined,
        state: form.state || undefined,
        primaryColor: form.primaryColor || undefined,
        features,
      });
      setResult(res);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save draft');
    } finally {
      setSubmitting(false);
    }
  }

  // Computed pricing
  const plan = PLANS.find(p => p.id === selectedPlan)!;
  const billingOpt = BILLING_OPTIONS.find(b => b.id === billing)!;
  const effectiveMonthly = Math.round(plan.basePrice * (1 - billingOpt.discount));
  const trialEnd = trialDays > 0 ? new Date(Date.now() + trialDays * 86_400_000) : null;

  const subdomainIndicator: Record<SubdomainStatus, { text: string; cls: string }> = {
    idle: { text: '', cls: '' },
    checking: { text: 'Checking…', cls: 'text-gray-400' },
    available: { text: '✓ Available', cls: 'text-emerald-400' },
    taken: { text: '✗ Already taken', cls: 'text-red-400' },
    invalid: { text: 'Must be 3-20 lowercase alphanumeric or hyphens', cls: 'text-amber-400' },
  };

  const canSubmit = !submitting && subdomainStatus === 'available' &&
    form.companyName && form.registrationNumber && form.address &&
    form.adminEmail && form.adminFirstName && form.adminLastName;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {result && <CredentialsModal result={result} onClose={() => setResult(null)} />}

      {/* Top bar */}
      <div className="sticky top-0 z-30 bg-gray-950/80 backdrop-blur border-b border-gray-800 px-8 py-4 flex items-center gap-4">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-white transition-colors">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <div className="flex items-center gap-2 text-xs text-gray-500 mb-0.5">
            <span className="hover:text-gray-300 cursor-pointer" onClick={() => router.push('/super-admin/dashboard')}>Dashboard</span>
            <span>/</span>
            <span className="hover:text-gray-300 cursor-pointer" onClick={() => router.push('/super-admin/tenants')}>Tenants</span>
            <span>/</span>
            <span className="text-gray-300">New Tenant</span>
          </div>
          <h1 className="font-bold text-white">Create New Tenant</h1>
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <main className="px-8 py-8 max-w-[1400px] mx-auto">
          {error && (
            <div className="mb-6 flex items-center gap-2 text-red-400 text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">
              <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            {/* ── Left Column ── */}
            <div className="space-y-6">
              {/* Company Information */}
              <SectionCard title="Company Information" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>}>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Company Name" required>
                    <Input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="Swift Finance Ltd" required maxLength={100} />
                  </Field>
                  <Field label="Subdomain" required hint={`${form.subdomain || '<subdomain>'}.lendershub.com`}>
                    <div className="relative">
                      <Input value={form.subdomain} onChange={(e) => handleSubdomainChange(e.target.value)} placeholder="swiftfinance" required minLength={3} maxLength={20} />
                      {subdomainStatus !== 'idle' && subdomainStatus !== 'checking' && (
                        <span className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs ${subdomainIndicator[subdomainStatus].cls}`}>
                          {subdomainIndicator[subdomainStatus].text}
                        </span>
                      )}
                    </div>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Registration Number" required hint="CIN / Registration No.">
                    <Input value={form.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} placeholder="U65900MH2020PTC000000" required maxLength={50} />
                  </Field>
                  <Field label="GST Number" hint="Optional">
                    <Input value={form.gstNumber} onChange={(e) => set('gstNumber', e.target.value)} placeholder="27AADCB2230M1ZT" maxLength={30} />
                  </Field>
                </div>
                <Field label="Registered Address" required>
                  <textarea value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Complete company address" required minLength={10} maxLength={500} rows={3}
                    className="w-full px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent resize-none text-sm" />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="City" required>
                    <Input value={form.city} onChange={(e) => set('city', e.target.value)} placeholder="Mumbai" maxLength={100} />
                  </Field>
                  <Field label="State" required>
                    <Select value={form.state} onChange={(e) => set('state', e.target.value)}>
                      <option value="">Select State</option>
                      {INDIAN_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  </Field>
                </div>
              </SectionCard>

              {/* Admin User Details */}
              <SectionCard title="Admin User Details" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>}>
                <div className="flex items-start gap-3 p-4 bg-blue-950/40 border border-blue-900/40 rounded-lg">
                  <svg className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                  </svg>
                  <div>
                    <p className="text-sm font-medium text-white">Default Administrator</p>
                    <p className="text-xs text-gray-400 mt-0.5">This user will have full administrative access to the tenant's system. A temporary password will be generated and emailed.</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="First Name" required>
                    <Input value={form.adminFirstName} onChange={(e) => set('adminFirstName', e.target.value)} placeholder="Rajesh" required maxLength={50} />
                  </Field>
                  <Field label="Last Name" required>
                    <Input value={form.adminLastName} onChange={(e) => set('adminLastName', e.target.value)} placeholder="Kumar" required maxLength={50} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Email" required hint="Welcome email will be sent here">
                    <Input type="email" value={form.adminEmail} onChange={(e) => set('adminEmail', e.target.value)} placeholder="admin@swiftfinance.com" required />
                  </Field>
                  <Field label="Temporary Password" hint="Auto-generated if left blank">
                    <Input type="text" value="" disabled placeholder="Auto-generated" className="cursor-not-allowed" />
                  </Field>
                </div>
              </SectionCard>

              {/* Branding & Customization */}
              <SectionCard title="Branding & Customization" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" /></svg>}>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Primary Color">
                    <div className="flex items-center gap-3">
                      <input type="color" value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)}
                        className="h-10 w-14 rounded-lg cursor-pointer bg-gray-800 border border-gray-700 p-1" />
                      <Input value={form.primaryColor} onChange={(e) => set('primaryColor', e.target.value)} placeholder="#7C3AED" maxLength={7} className="flex-1" />
                    </div>
                  </Field>
                  <Field label="Logo Upload" hint="PNG or SVG, max 2MB">
                    <label className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-gray-800 border border-gray-700 border-dashed cursor-pointer hover:border-violet-500 transition-colors text-sm text-gray-400">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      Upload Logo
                      <input type="file" accept="image/png,image/svg+xml" className="hidden" />
                    </label>
                  </Field>
                </div>
                <Field label="Custom Domain" hint="Configure DNS CNAME after creation">
                  <Input value={form.customDomain} onChange={(e) => set('customDomain', e.target.value)} placeholder="loans.swiftfinance.com" maxLength={200} />
                </Field>
              </SectionCard>
            </div>

            {/* ── Right Column ── */}
            <div className="space-y-6">
              {/* Subscription Plan */}
              <SectionCard title="Subscription Plan" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>}>
                {/* Plan cards */}
                <div className="grid grid-cols-3 gap-3">
                  {PLANS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedPlan(p.id)}
                      className={`relative text-left p-4 rounded-xl border-2 transition-all ${selectedPlan === p.id ? 'border-violet-500 bg-violet-900/20' : 'border-gray-700 hover:border-gray-600'}`}
                    >
                      {p.popular && (
                        <span className="absolute -top-2 right-3 text-[10px] font-bold px-2 py-0.5 rounded-md bg-gradient-to-r from-amber-500 to-orange-500 text-white">Popular</span>
                      )}
                      <p className="font-semibold text-sm text-white mb-1">{p.name}</p>
                      <p className="text-violet-400 font-bold text-lg">₹{(p.basePrice / 1000).toFixed(0)}K<span className="text-xs text-gray-500 font-normal">/mo</span></p>
                      <ul className="mt-3 pt-3 border-t border-gray-700 space-y-1.5">
                        {p.features.map((f) => (
                          <li key={f} className="text-[11px] text-gray-400 flex items-center gap-1.5">
                            <span className="text-emerald-400 text-xs">✓</span> {f}
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>

                {/* Billing Cycle */}
                <Field label="Billing Cycle">
                  <div className="grid grid-cols-3 gap-2">
                    {BILLING_OPTIONS.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setBilling(b.id)}
                        className={`relative py-2 px-3 rounded-lg border text-sm font-medium transition-all ${billing === b.id ? 'border-violet-500 bg-violet-900/20 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}
                      >
                        {b.label}
                        {b.discountLabel && (
                          <span className="absolute -top-2 right-1 text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-400">{b.discountLabel}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </Field>

                {/* Trial Period */}
                <Field label="Trial Period">
                  <Select value={String(trialDays)} onChange={(e) => setTrialDays(Number(e.target.value))}>
                    {TRIAL_OPTIONS.map((t) => (
                      <option key={t.days} value={t.days}>{t.label}</option>
                    ))}
                  </Select>
                </Field>
              </SectionCard>

              {/* Feature Configuration */}
              <SectionCard title="Feature Configuration" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}>
                <div className="space-y-2">
                  {FEATURE_TOGGLES.map((ft) => (
                    <div key={ft.key} className="flex items-center justify-between p-3 rounded-lg bg-gray-800/50">
                      <div>
                        <p className="text-sm font-medium text-white">{ft.label}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{ft.desc}</p>
                      </div>
                      <Toggle checked={features[ft.key] ?? false} onChange={(v) => setFeatures((f) => ({ ...f, [ft.key]: v }))} />
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* Summary */}
              <SectionCard title="Summary" icon={<svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>}>
                <div className="bg-violet-950/30 border border-violet-900/40 rounded-xl p-4 space-y-0">
                  {[
                    { label: 'Plan', value: PLANS.find(p => p.id === selectedPlan)?.name ?? '—' },
                    { label: 'Billing', value: BILLING_OPTIONS.find(b => b.id === billing)?.label ?? '—' },
                    { label: 'Trial Period', value: trialDays > 0 ? `${trialDays} Days` : 'None' },
                    { label: 'Setup Fee', value: `₹${SETUP_FEE.toLocaleString('en-IN')}` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between py-3 border-b border-violet-900/30 text-sm">
                      <span className="text-gray-400">{label}</span>
                      <span className="font-medium text-white">{value}</span>
                    </div>
                  ))}
                  <div className="flex justify-between pt-4 text-base font-bold">
                    <span className="text-white">Total Monthly</span>
                    <span className="text-violet-400">₹{effectiveMonthly.toLocaleString('en-IN')}</span>
                  </div>
                  {trialEnd && (
                    <p className="text-xs text-gray-500 pt-2">Trial ends {trialEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} · billing starts after</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-all shadow-lg shadow-violet-900/30"
                >
                  {submitting ? (
                    <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Provisioning…</>
                  ) : (
                    <><span>✓</span> Create Tenant</>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:text-white hover:border-gray-600 text-sm font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
                  </svg>
                  Save as Draft
                </button>
              </SectionCard>
            </div>
          </div>
        </main>
      </form>
    </div>
  );
}
