import { Bricolage_Grotesque, Figtree } from "next/font/google";
import LandingPage from "@/components/LandingPage";

// Fonts are scoped to the landing subtree via CSS variables so the tenant/admin
// apps keep their default (Geist) typography.
const figtree = Figtree({ subsets: ["latin"], variable: "--font-figtree", display: "swap" });
const bricolage = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });

export default function Home() {
  return (
    <div
      className={`${figtree.variable} ${bricolage.variable}`}
      style={{ fontFamily: "var(--font-figtree), system-ui, sans-serif" }}
    >
      <LandingPage />
    </div>
  );
}
