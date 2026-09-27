"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
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
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
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
      { threshold: 0.08 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delayMs]);
  return ref;
}

// Full class strings (not built by concatenation) so Tailwind can see them.
const ACCENTS = {
  teal: {
    tile: "from-teal-400 to-emerald-600 shadow-teal-500/30",
    chip: "bg-teal-50 text-teal-700 ring-teal-200",
    bar: "from-teal-400 to-emerald-500",
    eyebrow: "bg-teal-100 text-teal-800",
    border: "border-teal-500",
  },
  violet: {
    tile: "from-violet-500 to-fuchsia-600 shadow-violet-500/30",
    chip: "bg-violet-50 text-violet-700 ring-violet-200",
    bar: "from-violet-500 to-fuchsia-500",
    eyebrow: "bg-violet-100 text-violet-800",
    border: "border-violet-500",
  },
  sky: {
    tile: "from-sky-400 to-blue-600 shadow-sky-500/30",
    chip: "bg-sky-50 text-sky-700 ring-sky-200",
    bar: "from-sky-400 to-blue-500",
    eyebrow: "bg-sky-100 text-sky-800",
    border: "border-sky-500",
  },
  amber: {
    tile: "from-amber-400 to-orange-500 shadow-amber-500/30",
    chip: "bg-amber-50 text-amber-800 ring-amber-200",
    bar: "from-amber-400 to-orange-500",
    eyebrow: "bg-amber-100 text-amber-800",
    border: "border-amber-500",
  },
  rose: {
    tile: "from-rose-400 to-pink-600 shadow-rose-500/30",
    chip: "bg-rose-50 text-rose-700 ring-rose-200",
    bar: "from-rose-400 to-pink-500",
    eyebrow: "bg-rose-100 text-rose-800",
    border: "border-rose-500",
  },
  indigo: {
    tile: "from-indigo-500 to-violet-600 shadow-indigo-500/30",
    chip: "bg-indigo-50 text-indigo-700 ring-indigo-200",
    bar: "from-indigo-500 to-violet-500",
    eyebrow: "bg-indigo-100 text-indigo-800",
    border: "border-indigo-500",
  },
} as const;
type Accent = keyof typeof ACCENTS;
const ACCENT_CYCLE: Accent[] = ["teal", "violet", "sky", "amber", "rose", "indigo"];

const CONTAINER = "mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8";
const SECTION_Y = "py-16 sm:py-20 lg:py-28";

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
  { name: "Owner", blurb: "Full control — users, branches, settings & fund ledger" },
  { name: "Admin", blurb: "Users, branches, day-to-day settings & fund ledger" },
  { name: "Manager", blurb: "Approvals, closures, every loan & collection" },
  { name: "Loan Agent", blurb: "Field collector on the mobile app — their own book" },
  { name: "Staff", blurb: "Office desk — adds customers & loans for approval" },
  { name: "Customer", blurb: "Read-only view of their own loans & repayments" },
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

const STEP_ACCENTS: Accent[] = ["teal", "sky", "violet", "amber"];
// Mobile timeline segments, each fading from one step's colour into the next.
const STEP_SEGMENTS = ["from-teal-400 to-sky-400", "from-sky-400 to-violet-400", "from-violet-400 to-amber-400"];

function IconTile({ icon: Icon, accent, size = "md" }: { icon: typeof Landmark; accent: Accent; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl" : "h-12 w-12 rounded-xl";
  const glyph = size === "lg" ? "h-7 w-7" : "h-6 w-6";
  return (
    <div className={`flex shrink-0 items-center justify-center bg-gradient-to-br text-white shadow-lg ${box} ${ACCENTS[accent].tile}`}>
      <Icon className={glyph} strokeWidth={1.75} />
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  desc,
  accent,
  dark = false,
}: {
  eyebrow: string;
  title: string;
  desc?: string;
  accent: Accent;
  dark?: boolean;
}) {
  return (
    <div className="max-w-2xl">
      <span
        className={`inline-flex rounded-full px-3 py-1 text-[11px] font-bold tracking-[0.18em] uppercase ${
          dark ? "bg-white/10 text-teal-200 ring-1 ring-white/15" : ACCENTS[accent].eyebrow
        }`}
      >
        {eyebrow}
      </span>
      <h2
        className={`font-brand mt-4 text-[1.75rem] leading-tight font-bold tracking-tight sm:text-4xl ${
          dark ? "text-white" : "text-hub-900"
        }`}
      >
        {title}
      </h2>
      {desc && (
        <p className={`mt-4 text-base leading-relaxed sm:text-lg ${dark ? "text-slate-300" : "text-stone-600"}`}>{desc}</p>
      )}
    </div>
  );
}

function HeroBackdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute inset-0 bg-gradient-to-br from-hub-950 via-[#0b2545] to-[#2e1065]" />
      <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-teal-400/30 blur-3xl motion-safe:animate-soft-pulse sm:h-[28rem] sm:w-[28rem]" />
      <div className="absolute top-1/3 -right-32 h-80 w-80 rounded-full bg-fuchsia-500/25 blur-3xl motion-safe:animate-soft-pulse sm:h-[30rem] sm:w-[30rem]" />
      <div className="absolute -bottom-32 left-1/4 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl motion-safe:animate-soft-pulse sm:h-[26rem] sm:w-[26rem]" />
      <svg
        className="absolute inset-0 h-full w-full opacity-50"
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
          className="motion-safe:animate-map-draw"
          style={{ strokeDashoffset: 0 }}
        />
        <path
          d="M120 200 C300 260, 340 400, 520 440 S820 380, 940 520 S1200 700, 1360 640"
          stroke="#F0ABFC"
          strokeWidth="1.5"
          strokeOpacity="0.6"
          strokeLinecap="round"
        />
        {[
          [420, 480, "#5EEAD4"],
          [760, 400, "#F5D78E"],
          [1180, 220, "#F0ABFC"],
          [520, 440, "#7DD3FC"],
          [940, 520, "#FCA5A5"],
        ].map(([x, y, c], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r="18" className="motion-safe:animate-soft-pulse" fill={c as string} fillOpacity="0.18" />
            <circle cx={x} cy={y} r="7" fill={c as string} />
          </g>
        ))}
      </svg>
      <div className="absolute inset-0 bg-gradient-to-t from-hub-950/80 via-transparent to-hub-950/30" />
    </div>
  );
}

const HERO_BADGES = [
  { icon: WifiOff, label: "Offline-first collections", color: "text-teal-300" },
  { icon: Shield, label: "One schema per lender", color: "text-fuchsia-300" },
  { icon: MapPinned, label: "Built for Indian field lending", color: "text-amber-300" },
];

export default function LandingPage() {
  const audienceRef = useFadeIn();
  const productsRef = useFadeIn();
  const mobileRef = useFadeIn(80);
  const isolationRef = useFadeIn();
  const rolesRef = useFadeIn();
  const stepsRef = useFadeIn();
  const ctaRef = useFadeIn();

  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="overflow-x-clip bg-stone-50">
      {/* Header — fixed so Login stays one tap away on long mobile scrolls */}
      <header
        className={`fixed top-0 right-0 left-0 z-30 transition-[background-color,box-shadow,backdrop-filter] duration-300 ${
          scrolled ? "bg-hub-950/85 shadow-lg shadow-black/20 backdrop-blur-md" : "bg-transparent"
        }`}
      >
        <div className={`${CONTAINER} flex items-center justify-between gap-3 py-3 sm:py-4`}>
          <span className="font-brand text-lg font-bold tracking-tight whitespace-nowrap text-white">
            Lenders<span className="bg-gradient-to-r from-teal-300 to-sky-300 bg-clip-text text-transparent">Hub</span>
          </span>
          <nav className="flex items-center gap-1.5 sm:gap-2">
            <Link
              href="/super-admin/login"
              className="hidden min-h-11 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap text-white/80 transition-colors hover:bg-white/10 hover:text-white sm:inline-flex"
            >
              Admin Login
            </Link>
            <Link
              href="/login"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-gold-soft px-4 text-sm font-bold whitespace-nowrap text-hub-900 shadow-lg shadow-black/20 transition-colors hover:bg-white sm:px-5"
            >
              Tenant Login
              <ArrowRight className="h-4 w-4" />
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative flex min-h-[100svh] items-center overflow-hidden">
        <HeroBackdrop />
        <div className={`${CONTAINER} relative z-10 pt-28 pb-16 sm:pt-32 sm:pb-24`}>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-[0.18em] text-teal-200 uppercase ring-1 ring-white/15 backdrop-blur-sm motion-safe:animate-fade-up">
            <span className="h-1.5 w-1.5 rounded-full bg-teal-300" />
            LendersHub
          </span>
          <h1
            className="font-brand mt-5 max-w-3xl text-[2.5rem] leading-[1.05] font-extrabold tracking-tight text-white motion-safe:animate-fade-up sm:text-6xl lg:text-[4.25rem]"
            style={{ animationDelay: "80ms" }}
          >
            Run your lending book.{" "}
            <span className="bg-gradient-to-r from-teal-300 via-amber-200 to-pink-300 bg-clip-text text-transparent">
              Collect every installment.
            </span>
          </h1>
          <p
            className="mt-6 max-w-xl text-base leading-relaxed text-slate-200 motion-safe:animate-fade-up sm:text-xl"
            style={{ animationDelay: "160ms" }}
          >
            Multi-tenant SaaS for NBFCs and field lenders — branded web portal for
            the office, offline mobile for cash collections on the street.
          </p>
          <div
            className="mt-8 flex flex-col gap-3 motion-safe:animate-fade-up sm:mt-10 sm:flex-row sm:items-center"
            style={{ animationDelay: "240ms" }}
          >
            <Link
              href="/login"
              className="group inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full bg-gradient-to-r from-gold-soft to-amber-300 px-8 text-sm font-bold text-hub-900 shadow-xl shadow-amber-500/20 transition hover:brightness-105 active:scale-[0.98]"
            >
              Tenant Login
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <Link
              href="/super-admin/login"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/25 bg-white/10 px-8 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              Admin Login
              <ChevronRight className="h-4 w-4 opacity-70" />
            </Link>
          </div>
          <ul
            className="mt-10 flex flex-wrap gap-2 motion-safe:animate-fade-up sm:gap-3"
            style={{ animationDelay: "320ms" }}
          >
            {HERO_BADGES.map((b) => (
              <li
                key={b.label}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-2 text-xs font-medium text-white/90 ring-1 ring-white/15 backdrop-blur-sm sm:text-sm"
              >
                <b.icon className={`h-4 w-4 ${b.color}`} strokeWidth={2} />
                {b.label}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Audience */}
      <section ref={audienceRef} className={`bg-gradient-to-b from-sand to-stone-50 ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <SectionIntro
            eyebrow="Who it's for"
            title="Built for lending businesses that live on field collections"
            desc="Moneylenders, micro-finance ops, NBFCs, chit-fund style lenders, and small finance companies — especially where agents collect cash door-to-door across branches."
            accent="amber"
          />
          <div className="mt-10 grid gap-5 sm:mt-14 md:grid-cols-2">
            {[
              {
                icon: Building2,
                accent: "teal" as Accent,
                title: "Office on the web",
                desc: "Owners, managers, and office staff run products, KYC, approvals, fund ledger, and branch settings from a branded tenant portal.",
              },
              {
                icon: Smartphone,
                accent: "violet" as Accent,
                title: "Agents on mobile",
                desc: "Collectors unlock with biometrics, follow route maps, capture payments and receipts offline, then sync when they reconnect.",
              },
            ].map((c) => (
              <div key={c.title} className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 sm:p-8">
                <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${ACCENTS[c.accent].bar}`} />
                <IconTile icon={c.icon} accent={c.accent} size="lg" />
                <h3 className="font-brand mt-5 text-xl font-bold text-hub-900">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600 sm:text-base">{c.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Products */}
      <section id="products" ref={productsRef} className={`scroll-mt-20 bg-white ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <SectionIntro
            eyebrow="Core modules"
            title="Everything from loan setup to last-mile cash"
            desc="One stack for the full lending lifecycle — not a patchwork of sheets, WhatsApp groups, and offline notebooks."
            accent="teal"
          />
          <ul className="mt-8 flex flex-wrap gap-2">
            {LOAN_TYPES.map((t, i) => (
              <li
                key={t}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ring-1 ${ACCENTS[ACCENT_CYCLE[i % ACCENT_CYCLE.length]].chip}`}
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" strokeWidth={2} />
                {t}
              </li>
            ))}
          </ul>
          <div className="mt-10 grid gap-5 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const accent = ACCENT_CYCLE[i % ACCENT_CYCLE.length];
              return (
                <div
                  key={f.title}
                  className="group relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/5 transition duration-300 hover:-translate-y-1 hover:shadow-xl"
                >
                  <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${ACCENTS[accent].bar}`} />
                  <IconTile icon={f.icon} accent={accent} />
                  <h3 className="font-brand mt-5 text-lg font-bold text-hub-900">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Mobile */}
      <section id="mobile" ref={mobileRef} className={`relative scroll-mt-20 overflow-hidden ${SECTION_Y}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-hub-900 via-[#1e1b4b] to-[#3b0764]" />
        <div className="absolute top-0 right-0 h-96 w-96 rounded-full bg-teal-400/20 blur-3xl" />
        <div className="absolute bottom-0 left-0 h-80 w-80 rounded-full bg-fuchsia-500/20 blur-3xl" />
        <div className={`${CONTAINER} relative`}>
          <SectionIntro
            eyebrow="Field agent app"
            title="Designed for the collector on the beat"
            desc="Expo-powered React Native app with biometric unlock, collection routes, and receipt capture — so daily and weekly repayments keep flowing even when the network doesn't."
            accent="teal"
            dark
          />
          <div className="mt-10 grid gap-4 sm:mt-12 md:grid-cols-3 md:gap-5">
            {[
              { icon: Fingerprint, accent: "teal" as Accent, title: "Biometric unlock", desc: "Secure device access before viewing customer balances." },
              { icon: MapPinned, accent: "sky" as Accent, title: "Route map", desc: "See who to visit next across your collection beat." },
              { icon: Camera, accent: "amber" as Accent, title: "Receipt capture", desc: "Photo proof tied to the installment — synced later." },
            ].map((item) => (
              <div
                key={item.title}
                className="flex gap-4 rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10 backdrop-blur-sm md:flex-col md:p-6"
              >
                <IconTile icon={item.icon} accent={item.accent} />
                <div>
                  <h3 className="font-brand text-lg font-semibold text-white md:mt-1">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-300">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Isolation */}
      <section id="isolation" ref={isolationRef} className={`scroll-mt-20 bg-stone-50 ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <SectionIntro eyebrow="Architecture" title="True isolation — one Postgres schema per lender" accent="indigo" />
              <p className="mt-4 text-base leading-relaxed text-stone-600 sm:text-lg">
                Each tenant gets{" "}
                <code className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-700">tenant_&lt;slug&gt;</code>{" "}
                with its own users and data. Super-admin operates on the public
                schema. No shared-table RLS guessing — no cross-tenant leakage by design.
              </p>
            </div>
            <div className="flex max-w-sm items-start gap-4 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/5">
              <IconTile icon={Shield} accent="indigo" />
              <p className="text-sm leading-relaxed text-stone-600">
                NestJS API + Redis + Prisma, with{" "}
                <span className="font-semibold text-indigo-700">SET search_path</span>{" "}
                per request so every query stays inside the right tenant.
              </p>
            </div>
          </div>
          <div className="mt-10 grid gap-4 font-mono text-sm sm:mt-14 sm:grid-cols-3">
            {[
              { label: "public", sub: "Super-admin · subscriptions · tenants", accent: "amber" as Accent },
              { label: "tenant_axis", sub: "Isolated books · users · KYC", accent: "teal" as Accent },
              { label: "tenant_nova", sub: "Isolated books · users · KYC", accent: "violet" as Accent },
            ].map((s) => (
              <div key={s.label} className={`rounded-xl border-l-4 bg-white py-4 pr-4 pl-5 shadow-sm ring-1 ring-black/5 ${ACCENTS[s.accent].border}`}>
                <p className="font-semibold text-hub-900">{s.label}</p>
                <p className="mt-1 font-sans text-xs text-stone-500">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section id="roles" ref={rolesRef} className={`scroll-mt-20 bg-white ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <SectionIntro
            eyebrow="Access control"
            title="Six roles, one hierarchy"
            desc="From business owner to borrower — permissions that match how lending teams actually work."
            accent="violet"
          />
          <ol className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3">
            {ROLES.map((role, i) => {
              const accent = ACCENT_CYCLE[i % ACCENT_CYCLE.length];
              return (
                <li key={role.name} className="flex items-start gap-4 rounded-2xl bg-stone-50 p-5 ring-1 ring-black/5">
                  <span
                    className={`font-brand flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white shadow-md tabular-nums ${ACCENTS[accent].tile}`}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <h3 className="font-brand text-lg font-bold text-hub-900">{role.name}</h3>
                    <p className="mt-0.5 text-sm text-stone-600">{role.blurb}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </section>

      {/* Steps — vertical timeline on phones/tablets, horizontal on desktop */}
      <section ref={stepsRef} className={`bg-gradient-to-b from-sand to-stone-50 ${SECTION_Y}`}>
        <div className={CONTAINER}>
          <SectionIntro eyebrow="How it works" title="From onboarding to field ops" accent="sky" />
          <div className="relative mt-10 sm:mt-14">
            <div
              className="absolute top-5 right-[12.5%] left-[12.5%] hidden h-0.5 bg-gradient-to-r from-teal-400 via-violet-400 to-amber-400 lg:block"
              aria-hidden
            />
            <ol className="relative grid gap-8 lg:grid-cols-4 lg:gap-6">
              {STEPS.map((step, i) => (
                <li key={step.num} className="relative pl-16 lg:pl-0 lg:text-center">
                  {i < STEPS.length - 1 && (
                    <span
                      className={`absolute top-10 -bottom-8 left-5 w-0.5 -translate-x-1/2 bg-gradient-to-b lg:hidden ${STEP_SEGMENTS[i]}`}
                      aria-hidden
                    />
                  )}
                  <span
                    className={`font-brand absolute top-0 left-0 flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br text-sm font-bold text-white ring-4 ring-sand lg:relative lg:mx-auto ${ACCENTS[STEP_ACCENTS[i]].tile}`}
                  >
                    {step.num}
                  </span>
                  <h3 className="font-brand text-lg font-bold text-hub-900 lg:mt-5">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-stone-600">{step.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Operator */}
      <section className="bg-white py-12 sm:py-16">
        <div className={CONTAINER}>
          <div className="flex flex-col gap-5 rounded-2xl bg-gradient-to-r from-teal-50 via-sky-50 to-violet-50 p-6 ring-1 ring-black/5 sm:flex-row sm:items-center sm:gap-8 sm:p-8">
            <IconTile icon={LayoutDashboard} accent="sky" size="lg" />
            <div>
              <h2 className="font-brand text-xl font-bold text-hub-900">For the platform operator</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-stone-600">
                Super-admin onboards lender tenants, manages subscription tiers, and
                monitors the platform dashboard — while each lender stays sealed in
                their own schema.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-sky-800 sm:ml-auto sm:shrink-0">
              <Bell className="h-4 w-4" />
              <Users className="h-4 w-4" />
              <span>Lifecycle &amp; subscriptions</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section ref={ctaRef} className="bg-white pb-16 sm:pb-20 lg:pb-28">
        <div className={CONTAINER}>
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-teal-600 via-indigo-700 to-fuchsia-700 px-6 py-14 text-center shadow-2xl shadow-indigo-900/20 sm:px-12 sm:py-20">
            <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-teal-300/30 blur-3xl" aria-hidden />
            <div className="absolute -right-16 -bottom-24 h-72 w-72 rounded-full bg-amber-300/25 blur-3xl" aria-hidden />
            <div className="relative mx-auto max-w-2xl">
              <h2 className="font-brand text-[1.75rem] leading-tight font-bold tracking-tight text-white sm:text-4xl">
                Ready to modernize your collections?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base text-white/85 sm:text-lg">
                Give your office a branded portal and your field agents an offline-first
                app — without sharing a database with other lenders.
              </p>
              <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:mt-10 sm:flex-row sm:items-center">
                <Link
                  href="/login"
                  className="group inline-flex min-h-12 items-center justify-center gap-2.5 rounded-full bg-white px-8 text-sm font-bold text-indigo-800 shadow-xl transition hover:bg-gold-soft hover:text-hub-900 active:scale-[0.98]"
                >
                  Tenant Login
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/super-admin/login"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-white/30 bg-white/10 px-8 text-sm font-semibold text-white transition hover:bg-white/20"
                >
                  Admin Login
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-hub-950 py-8">
        <div className={`${CONTAINER} flex flex-col items-center justify-between gap-2 text-center text-sm text-stone-400 sm:flex-row sm:text-left`}>
          <span className="font-brand font-bold text-white">
            Lenders<span className="bg-gradient-to-r from-teal-300 to-sky-300 bg-clip-text text-transparent">Hub</span>
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
