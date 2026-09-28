import { DM_Sans, Manrope } from "next/font/google";

const body = DM_Sans({ subsets: ["latin"], variable: "--font-public-body", display: "swap" });
const heading = Manrope({ subsets: ["latin"], variable: "--font-public-heading", display: "swap" });

export const publicFonts = `${body.variable} ${heading.variable}`;
