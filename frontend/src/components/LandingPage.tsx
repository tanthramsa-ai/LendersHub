"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import {
  ArrowRight,
  Bell,
  Building2,
  Camera,
  CheckCircle2,
  ChevronRight,
  Fingerprint,
  Landmark,
  LayoutDashboard,
  MapPinned,
  MessageSquare,
  Shield,
  Smartphone,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";

function useFadeIn(delayMs = 0) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.opacity = "0";
    el.style.transform = "translateY(28px)";
    el.style.transition = `opacity 0.75s cubic-bezier(0.16,1,0.3,1) ${delayMs}ms, transform 0.75s cubic-bezier(0.16,1,0.3,1) ${delayMs}ms`;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.style.opacity = "1";
          el.style.transform = "translateY(0)";
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);
  return ref;
}

const LOAN_TYPES = [
  "Weekly installment",
  "Daily collection",
  "Monthly interest-only",
  "Agent-risk loans",
  "Term loans",
  "EMI preview",
];

const FEATURES = [
  {
    icon: Landmark,
    title: "Loan products that match how you lend",
    desc: "Configure weekly, daily, interest-only, agent-risk, and term products with EMI preview — built for Indian micro-lending ops.",
  },
  {
    icon: Fingerprint,
    title: "KYC ready for India",
    desc: "Customer profiles with PAN, Aadhaar, and branch-aware records so office staff and field agents share one source of truth.",
  },
  {
    icon: WifiOff,
    title: "Offline-first collections",
    desc: "Collectors capture payments without signal, sync when back online, and keep routes moving in low-connectivity markets.",
  },
  {
    icon: Camera,
    title: "Cash receipts with proof",
    desc: "Photo-backed receipts and payment captures reduce disputes between agents, customers, and branch accounts.",
  },
  {
    icon: Wallet,
    title: "Fund ledger & branches",
    desc: "Track cash across branches, reconcile collections, and give managers a live view of money in motion.",
  },
  {
    icon: MessageSquare,
    title: "SMS & WhatsApp providers",
    desc: "Pluggable Fast2SMS, Msg91, and WhatsApp for OTP login and customer notifications — swap providers without rewrites.",
  },
];

const ROLES = [
  { name: "Owner", blurb: "Full control — users, branches, settings" },
  { name: "Manager", blurb: "Approvals, closures, operations dashboards" },
  { name: "Admin", blurb: "Users, branches, day-to-day settings" },
  { name: "Loan Officer", blurb: "Create loans & record portfolio payments" },
  { name: "Collector", blurb: "Field agent — primary mobile app user" },
  { name: "Viewer", blurb: "Read-only access across modules" },
];

const STEPS = [
  {
    num: "01",
    title: "Onboard your tenant",
    desc: "We provision an isolated schema, brand your portal, and set subscription tier.",
  },
  {
    num: "02",
    title: "Configure products & branches",
    desc: "Define loan types, KYC fields, branches, and who can approve what.",
  },
  {
    num: "03",
    title: "Put agents on the road",
    desc: "Collectors install the app, unlock with biometrics, and run offline route collections.",
  },
  {
    num: "04",
    title: "Operate & grow",
    desc: "Office staff manage loans on web; ledger, notifications, and reports stay in sync.",
  },
];

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-br from-hub-950 via-hub-800 to-[#0a2f2a]" />
      <div className="absolute inset-0 opacity-[0.35] mix-blend-soft-light bg-[radial-gradient(ellipse_at_20%_30%,#5eead4_0%,transparent_50%),radial-gradient(ellipse_at_80%_70%,#c9a227_0%,transparent_45%)]" />
      <svg
        className="absolute inset-0 h-full w-full opacity-40"
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        fill="none"
      >
        <path
          d="M80 720 C220 680, 280 520, 420 480 S680 520, 760 400 S980 180, 1180 220 S1380 360, 1420 280"
          stroke="#5EEAD4"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="120"
          className="animate-map-draw"
          style={{ strokeDashoffset: 0 }}
        />
        <path
          d="M120 200 C300 260, 340 400, 520 440 S820 380, 940 520 S1200 700, 1360 640"
          stroke="#F5D78E"
          strokeWidth="1.5"
          strokeOpacity="0.55"
          strokeLinecap="round"
        />
        {[
          [420, 480],
          [760, 400],
          [1180, 220],
          [520, 440],
          [940, 520],
        ].map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="18" className="animate-soft-pulse" fill="#5EEAD4" fillOpacity="0.15" />
            <circle cx={x} cy={y} r="7" fill="#F5D78E" />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-hub-950/90 via-hub-950/35 to-hub-950/50" />
    </div>
  );
}

export default function LandingPage() {
  const audienceRef = useFadeIn();
  const productsRef = useFadeIn();
  const mobileRef = useFadeIn(80);
  const isolationRef = useFadeIn();
  const rolesRef = useFadeIn();
  const stepsRef = useFadeIn();
  const ctaRef = useFadeIn();

  return (
    <div className="bg-stone-50">
      {/* Slim header */}
      <header className="absolute top-0 right-0 left-0 z-20">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5 lg:px-8">
          <span className="font-brand text-[17px] font-bold tracking-tight text-white">
            Lenders<span className="text-hub-300">Hub</span>
          </span>
          <div className="flex items-center gap-2">
            <Link
              href="/super-admin/login"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            >
              Admin Login
            </Link>
            <Link
              href="/login"
              className="rounded-xl bg-gold-soft px-4 py-2.5 text-sm font-bold text-hub-900 shadow-lg transition-colors hover:bg-white"
            >
              Tenant Login
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[100svh] items-end overflow-hidden sm:items-center">
        <HeroBackdrop />
        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pt-28 pb-16 sm:py-32 lg:px-8">
          <p className="font-brand animate-fade-up text-sm font-semibold tracking-[0.2em] text-hub-300 uppercase">
            LendersHub
          </p>
          <h1
            className="font-brand mt-4 max-w-3xl animate-fade-up text-[2.75rem] leading-[1.05] font-extrabold tracking-tight text-white sm:text-6xl lg:text-[4.25rem]"
            style={{ animationDelay: "80ms" }}
          >
            Run your lending book. Collect every installment.
          </h1>
          <p
            className="mt-6 max-w-xl animate-fade-up text-lg leading-relaxed text-stone-300 sm:text-xl"
            style={{ animationDelay: "160ms" }}
          >
            Multi-tenant SaaS for NBFCs and field lenders — branded web portal for
            the office, offline mobile for cash collections on the street.
          </p>
          <div
            className="mt-10 flex animate-fade-up flex-col items-stretch gap-3 sm:flex-row sm:items-center"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              href="/login"
              className="group inline-flex items-center justify-center gap-2.5 rounded-xl bg-gold-soft px-8 py-3.5 text-sm font-bold text-hub-900 shadow-xl shadow-black/25 transition hover:bg-white active:scale-[0.98]"
            >
              Tenant Login
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/super-admin/login"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-8 py-3.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
            >
              Admin Login
              <ChevronRight className="h-4 w-4 opacity-60" />
            </Link>
          </div>
        </div>
      </section>

      {/* Audience */}
      <section ref={audienceRef} className="bg-sand py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <p className="text-xs font-bold tracking-[0.22em] text-hub-600 uppercase">Who it&apos;s for</p>
          <h2 className="font-brand mt-3 max-w-2xl text-3xl font-bold tracking-tight text-hub-900 sm:text-4xl">
            Built for lending businesses that live on field collections
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-stone-600">
            Moneylenders, micro-finance ops, NBFCs, chit-fund style lenders, and
            small finance companies — especially where agents collect cash
            door-to-door across branches.
          </p>
          <div className="mt-14 grid gap-10 sm:grid-cols-2">
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-hub-800 text-hub-200">
                <Building2 className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <h3 className="font-brand mt-5 text-xl font-bold text-hub-900">Office on the web</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                Owners, managers, and loan officers run products, KYC, approvals,
                fund ledger, and branch settings from a branded tenant portal.
              </p>
            </div>
            <div>
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-hub-800 text-hub-200">
                <Smartphone className="h-5 w-5" strokeWidth={1.75} />
              </div>
              <h3 className="font-brand mt-5 text-xl font-bold text-hub-900">Agents on mobile</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">
                Collectors unlock with biometrics, follow route maps, capture
                payments and receipts offline, then sync when they reconnect.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="products" ref={productsRef} className="scroll-mt-24 bg-white py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <p className="text-xs font-bold tracking-[0.22em] text-hub-600 uppercase">Core modules</p>
          <h2 className="font-brand mt-3 max-w-2xl text-3xl font-bold tracking-tight text-hub-900 sm:text-4xl">
            Everything from loan setup to last-mile cash
          </h2>
          <p className="mt-4 max-w-xl text-base text-stone-600">
            One stack for the full lending lifecycle — not a patchwork of sheets,
            WhatsApp groups, and offline notebooks.
          </p>
          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {LOAN_TYPES.map((t) => (
              <li key={t} className="flex items-center gap-2 text-sm text-hub-800">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-hub-500" strokeWidth={2} />
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <f.icon className="h-6 w-6 text-hub-600" strokeWidth={1.5} />
                <h3 className="font-brand mt-4 text-lg font-bold text-hub-900">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Mobile */}
      <section id="mobile" ref={mobileRef} className="relative scroll-mt-24 overflow-hidden py-24 sm:py-28">
        <div className="absolute inset-0 bg-hub-900" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_40%,#14b8a6_0%,transparent_55%)] opacity-30" />
        <div className="relative mx-auto max-w-6xl px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-xs font-bold tracking-[0.22em] text-hub-300 uppercase">Field agent app</p>
            <h2 className="font-brand mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Designed for the collector on the beat
            </h2>
            <p className="mt-4 text-base leading-relaxed text-stone-300">
              Expo-powered React Native app with biometric unlock, collection
              routes, and receipt capture — so daily and weekly repayments keep
              flowing even when the network doesn&apos;t.
            </p>
          </div>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {[
              { icon: Fingerprint, title: "Biometric unlock", desc: "Secure device access before viewing customer balances." },
              { icon: MapPinned, title: "Route map", desc: "See who to visit next across your collection beat." },
              { icon: Camera, title: "Receipt capture", desc: "Photo proof tied to the installment — synced later." },
            ].map((item) => (
              <div key={item.title}>
                <item.icon className="h-6 w-6 text-gold-soft" strokeWidth={1.5} />
                <h3 className="font-brand mt-4 text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-400">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Isolation */}
      <section id="isolation" ref={isolationRef} className="scroll-mt-24 bg-stone-50 py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <p className="text-xs font-bold tracking-[0.22em] text-hub-600 uppercase">Architecture</p>
              <h2 className="font-brand mt-3 text-3xl font-bold tracking-tight text-hub-900 sm:text-4xl">
                True isolation — one Postgres schema per lender
              </h2>
              <p className="mt-4 text-base leading-relaxed text-stone-600">
                Each tenant gets{" "}
                <code className="font-semibold text-hub-800">tenant_&lt;slug&gt;</code>{" "}
                with its own users and data. Super-admin operates on the public
                schema. No shared-table RLS guessing — no cross-tenant leakage by design.
              </p>
            </div>
            <div className="flex max-w-sm items-start gap-3">
              <Shield className="h-8 w-8 shrink-0 text-hub-600" strokeWidth={1.5} />
              <p className="text-sm leading-relaxed text-stone-600">
                NestJS API + Redis + Prisma, with{" "}
                <span className="font-semibold text-hub-800">SET search_path</span>{" "}
                per request so every query stays inside the right tenant.
              </p>
            </div>
          </div>
          <div className="mt-14 grid gap-6 font-mono text-sm sm:grid-cols-3">
            {[
              { label: "public", sub: "Super-admin · subscriptions · tenants" },
              { label: "tenant_axis", sub: "Isolated books · users · KYC" },
              { label: "tenant_nova", sub: "Isolated books · users · KYC" },
            ].map((s) => (
              <div key={s.label} className="border-l-2 border-hub-500 py-1 pl-5">
                <p className="font-semibold text-hub-800">{s.label}</p>
                <p className="mt-1 font-sans text-xs text-stone-500">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" ref={rolesRef} className="scroll-mt-24 bg-white py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <p className="text-xs font-bold tracking-[0.22em] text-hub-600 uppercase">Access control</p>
          <h2 className="font-brand mt-3 text-3xl font-bold tracking-tight text-hub-900 sm:text-4xl">
            Six roles, one hierarchy
          </h2>
          <p className="mt-4 max-w-xl text-base text-stone-600">
            From business owner to read-only viewer — permissions that match how
            lending teams actually work.
          </p>
          <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((role, i) => (
              <li key={role.name} className="flex gap-4 border-t border-stone-200 pt-5">
                <span className="font-brand text-2xl font-bold text-hub-200 tabular-nums">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="font-brand text-lg font-bold text-hub-900">{role.name}</h3>
                  <p className="mt-1 text-sm text-stone-600">{role.blurb}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Steps */}
      <section ref={stepsRef} className="bg-sand py-24 sm:py-28">
        <div className="mx-auto max-w-6xl px-6 lg:px-8">
          <p className="text-xs font-bold tracking-[0.22em] text-hub-600 uppercase">How it works</p>
          <h2 className="font-brand mt-3 text-3xl font-bold tracking-tight text-hub-900 sm:text-4xl">
            From onboarding to field ops
          </h2>
          <div className="mt-14 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((step) => (
              <div key={step.num}>
                <span className="font-brand text-sm font-bold tracking-widest text-hub-500">{step.num}</span>
                <h3 className="font-brand mt-3 text-lg font-bold text-hub-900">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Operator */}
      <section className="border-y border-stone-200 bg-white py-16">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-6 sm:flex-row sm:items-center sm:gap-10 lg:px-8">
          <LayoutDashboard className="h-10 w-10 shrink-0 text-hub-600" strokeWidth={1.5} />
          <div>
            <h2 className="font-brand text-xl font-bold text-hub-900">For the platform operator</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
              Super-admin onboards lender tenants, manages subscription tiers, and
              monitors the platform dashboard — while each lender stays sealed in
              their own schema.
            </p>
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-500 sm:ml-auto">
            <Bell className="h-4 w-4" />
            <Users className="h-4 w-4" />
            <span>Lifecycle &amp; subscriptions</span>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section ref={ctaRef} className="relative overflow-hidden bg-hub-800 py-24">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_30%_50%,#5eead4_0%,transparent_50%)] opacity-40" />
        <div className="relative mx-auto max-w-3xl px-6 text-center lg:px-8">
          <h2 className="font-brand text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to modernize your collections?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-hub-100">
            Give your office a branded portal and your field agents an offline-first
            app — without sharing a database with other lenders.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login"
              className="group inline-flex items-center gap-2.5 rounded-xl bg-gold-soft px-8 py-4 text-sm font-bold text-hub-900 shadow-xl transition hover:bg-white active:scale-[0.98]"
            >
              Tenant Login
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/super-admin/login"
              className="inline-flex items-center gap-2 rounded-xl border border-white/25 bg-white/5 px-8 py-4 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              Admin Login
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-hub-950 py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-6 text-sm text-stone-400 sm:flex-row lg:px-8">
          <span className="font-brand font-bold text-white">
            Lenders<span className="text-hub-300">Hub</span>
          </span>
          <span>
            © 2026 · A product by{" "}
            <a
              href="https://www.tanthramsa.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-stone-300 hover:text-white"
            >
              Tanthramsa
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
