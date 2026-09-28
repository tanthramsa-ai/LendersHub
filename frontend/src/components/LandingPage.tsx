"use client";

import { useState } from "react";
import Link from "next/link";
import { publicFonts } from "./public-fonts";
import "@/styles/lendershub.css";
import {
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronRight,
  IndianRupee,
  Menu,
  Route,
  Smartphone,
  UsersRound,
  X,
} from "lucide-react";
import { BrandMark } from "./BrandMark";

const features = [
  {
    icon: Route,
    number: "01",
    title: "Loan lifecycle",
    copy: "Move daily, weekly and monthly loans from customer record to approval and repayment, without losing the thread.",
  },
  {
    icon: Smartphone,
    number: "02",
    title: "Collections in the field",
    copy: "Give field teams a focused mobile workflow that stays useful when connectivity is unreliable.",
  },
  {
    icon: BookOpenCheck,
    number: "03",
    title: "Ledger & reconciliation",
    copy: "Bring payment activity and ledger entries together for a cleaner close and fewer loose ends.",
  },
];

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main className={`${publicFonts} lh-public`}>
      <header className="lh-header">
        <div className="lh-container lh-header__inner">
          <Link href="/" aria-label="LendersHub home"><BrandMark /></Link>
          <nav className="lh-nav" aria-label="Main navigation">
            <a href="#product">Product</a>
            <a href="#how-it-works">How it works</a>
            <Link href="/login">Sign in</Link>
          </nav>
          <Link href="/login" className="lh-button lh-button--compact lh-header__cta">Open your workspace <ArrowRight size={16} /></Link>
          <button className="lh-menu-button" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X size={21} /> : <Menu size={21} />}
          </button>
        </div>
        {menuOpen && (
          <nav className="lh-mobile-nav" aria-label="Mobile navigation">
            <a href="#product" onClick={() => setMenuOpen(false)}>Product</a>
            <a href="#how-it-works" onClick={() => setMenuOpen(false)}>How it works</a>
            <Link href="/login">Sign in <ArrowRight size={16} /></Link>
          </nav>
        )}
      </header>

      <section className="lh-hero">
        <div className="lh-container lh-hero__grid">
          <div className="lh-hero__copy">
            <p className="lh-kicker">Operations software for modern lenders</p>
            <h1>Your lending business.<br /><em>In good order.</em></h1>
            <p className="lh-hero__lede">A focused workspace for loans, customers, field collections and a reconciled ledger—built around how Indian lending teams actually work.</p>
            <div className="lh-hero__actions">
              <Link href="/login" className="lh-button">Open your workspace <ArrowRight size={18} /></Link>
              <a href="#product" className="lh-text-link">Explore the platform <ChevronRight size={17} /></a>
            </div>
            <div className="lh-hero__notes" aria-label="Platform qualities">
              <span><Check size={15} /> Daily, weekly & monthly loans</span>
              <span><Check size={15} /> Built for field teams</span>
            </div>
          </div>

          <div className="lh-dashboard" aria-label="Illustrative LendersHub portfolio dashboard">
            <div className="lh-dashboard__topbar">
              <div className="lh-dashboard__dots"><i /><i /><i /></div>
              <span>Portfolio overview</span>
              <span className="lh-dashboard__sample">Sample data</span>
            </div>
            <div className="lh-dashboard__body">
              <aside className="lh-dashboard__rail" aria-hidden="true">
                <span className="is-active"><IndianRupee size={17} /></span>
                <span><UsersRound size={17} /></span>
                <span><BookOpenCheck size={17} /></span>
              </aside>
              <div className="lh-dashboard__content">
                <div className="lh-dashboard__heading"><div><small>Good morning, team</small><strong>Today&apos;s portfolio</strong></div><span>28 Sep 2026</span></div>
                <div className="lh-metrics">
                  <div><small>Active principal</small><strong>₹84.6L</strong><span className="lh-positive">↑ 4.8% this month</span></div>
                  <div><small>Due today</small><strong>₹3.24L</strong><span>418 instalments</span></div>
                  <div><small>Collected</small><strong>₹2.71L</strong><span className="lh-positive">83.6% complete</span></div>
                </div>
                <div className="lh-dashboard__lower">
                  <div className="lh-chart">
                    <div className="lh-chart__label"><div><small>Collection activity</small><strong>₹12.8L</strong></div><span>Last 7 days</span></div>
                    <div className="lh-bars" aria-hidden="true"><i style={{height:"42%"}}/><i style={{height:"64%"}}/><i style={{height:"51%"}}/><i style={{height:"78%"}}/><i style={{height:"68%"}}/><i style={{height:"91%"}}/><i style={{height:"74%"}}/></div>
                    <div className="lh-chart__days"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div>
                  </div>
                  <div className="lh-statuses">
                    <small>Payment status</small>
                    <div><span className="lh-status-dot lh-status-dot--paid" />On time <strong>326</strong></div>
                    <div><span className="lh-status-dot lh-status-dot--due" />Due today <strong>72</strong></div>
                    <div><span className="lh-status-dot lh-status-dot--late" />Follow-up <strong>20</strong></div>
                  </div>
                </div>
                <p className="lh-dashboard__footnote">Illustrative figures for product preview only</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="lh-product" id="product">
        <div className="lh-container">
          <div className="lh-section-intro"><p className="lh-kicker">A clearer operating workflow</p><h2>From first approval to final entry.</h2><p>LendersHub keeps everyday lending work connected, visible and ready for the next decision.</p></div>
          <div className="lh-feature-grid">
            {features.map(({ icon: Icon, number, title, copy }) => (
              <article className="lh-feature" key={title}>
                <div className="lh-feature__top"><span><Icon size={21} /></span><small>{number}</small></div>
                <h3>{title}</h3><p>{copy}</p><div className="lh-feature__line" />
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="lh-how" id="how-it-works">
        <div className="lh-container lh-how__grid">
          <div className="lh-how__intro"><p className="lh-kicker lh-kicker--mint">How it works</p><h2>Structure for every working day.</h2><p>Simple enough for fast-moving teams. Rigorous enough for a dependable operating record.</p></div>
          <ol className="lh-steps">
            <li><span>1</span><div><h3>Set up the portfolio</h3><p>Organise customers, products and repayment schedules in one workspace.</p></div></li>
            <li><span>2</span><div><h3>Run the day</h3><p>Approve loans, assign collections and track payment activity as it happens.</p></div></li>
            <li><span>3</span><div><h3>Close with confidence</h3><p>Review exceptions, reconcile entries and start tomorrow with a clear position.</p></div></li>
          </ol>
        </div>
      </section>

      <section className="lh-final">
        <div className="lh-container lh-final__inner">
          <div><p className="lh-kicker">Your workspace is ready</p><h2>Put the whole lending day in order.</h2></div>
          <Link href="/login" className="lh-button lh-button--light">Open your workspace <ArrowRight size={18} /></Link>
        </div>
      </section>
      <footer className="lh-footer"><div className="lh-container"><BrandMark /><p>Thoughtful software for lending operations.</p><a href="https://www.tanthramsa.com/" target="_blank" rel="noreferrer">LendersHub by Tanthramsa <ArrowRight size={14} /></a></div></footer>
    </main>
  );
}
