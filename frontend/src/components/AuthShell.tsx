import type { ReactNode } from "react";
import { ArrowLeft, CheckCircle2, IndianRupee, Landmark, Link2, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { publicFonts } from "./public-fonts";
import "@/styles/lendershub.css";
import { BrandMark } from "./BrandMark";
import { platformHref } from "@/lib/public-routes";

interface AuthShellProps {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthShell({ eyebrow, title, description, children }: AuthShellProps) {
  return (
    <main className={`${publicFonts} lh-public lh-auth`}>
      <section className="lh-auth__visual" aria-label="LendersHub overview">
        <Link href={platformHref('/')} className="lh-auth__back"><ArrowLeft size={17} /> Back to LendersHub</Link>
        <BrandMark inverse />
        <div className="lh-auth__message">
          <p className="lh-kicker lh-kicker--mint">Lending operations, connected</p>
          <h2>A clear view of every moving part.</h2>
          <p>Keep customers, repayments, field collections and your ledger aligned from one working day to the next.</p>
        </div>
        <div className="lh-ledger-visual" aria-hidden="true">
          <div className="lh-ledger-visual__node lh-ledger-visual__node--top"><Landmark size={18} /><span>Portfolio</span></div>
          <div className="lh-ledger-visual__line lh-ledger-visual__line--a" />
          <div className="lh-ledger-visual__line lh-ledger-visual__line--b" />
          <div className="lh-ledger-visual__node lh-ledger-visual__node--left"><IndianRupee size={18} /><span>Collections</span></div>
          <div className="lh-ledger-visual__node lh-ledger-visual__node--right"><Link2 size={18} /><span>Ledger</span></div>
          <div className="lh-ledger-visual__status"><CheckCircle2 size={16} /> Reconciled</div>
        </div>
        <div className="lh-auth__assurance"><ShieldCheck size={17} /><span>Built for focused, accountable operations</span></div>
      </section>
      <section className="lh-auth__form-panel">
        <Link href={platformHref('/')} className="lh-auth__mobile-brand" aria-label="LendersHub home"><BrandMark /></Link>
        <div className="lh-auth__form-wrap">
          <p className="lh-kicker">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="lh-auth__description">{description}</p>
          {children}
        </div>
        <p className="lh-auth__legal">LendersHub by <a href="https://www.tanthramsa.com/" target="_blank" rel="noreferrer">Tanthramsa</a></p>
      </section>
    </main>
  );
}
