import Link from "next/link";

const BRAND = "#0F4C81";

const FEATURES = [
  { title: "Loan Management", desc: "Monthly, weekly & daily cycles with automated EMI schedules and NPA tracking." },
  { title: "Field Collections", desc: "Agent app for on-the-ground payment capture, receipts and offline sync." },
  { title: "Multi-Branch", desc: "Branch-scoped users, customers and portfolios with role-based access." },
  { title: "Secure by Tenant", desc: "Every lending company runs in an isolated database schema — no data crosses over." },
];

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-white text-gray-900">
      {/* Header */}
      <header className="w-full border-b border-gray-100">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-bold" style={{ color: BRAND }}>LendersHub</span>
          <Link
            href="/super-admin/login"
            className="text-sm font-medium text-gray-500 transition-colors hover:text-gray-900"
          >
            Admin Login
          </Link>
        </div>
      </header>

      {/* Hero */}
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
          The lending platform for modern finance companies
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-8 text-gray-600">
          Originate loans, run daily and weekly collections, manage branches and staff, and
          track every rupee — all in one multi-tenant workspace.
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login"
            className="flex h-12 items-center justify-center rounded-xl px-8 text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: BRAND }}
          >
            Tenant Login
          </Link>
          <Link
            href="/super-admin/login"
            className="flex h-12 items-center justify-center rounded-xl border border-gray-200 px-8 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50"
          >
            Admin Login
          </Link>
        </div>

        {/* Features */}
        <div className="mt-20 grid w-full grid-cols-1 gap-5 text-left sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-100 bg-gray-50/60 p-6">
              <h3 className="font-semibold text-gray-900">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-gray-600">{f.desc}</p>
            </div>
          ))}
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full border-t border-gray-100">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-2 px-6 py-6 text-sm text-gray-400 sm:flex-row">
          <span>© {"2026"} LendersHub</span>
          <span>
            A product by{" "}
            <a
              href="https://www.tanthramsa.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-gray-500 hover:text-gray-900"
            >
              Tanthramsa
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
