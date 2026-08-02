import type { Metadata } from "next";
import { Archivo, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { CartDrawer } from "@/components/cart/CartDrawer";
import { AuthProvider } from "@/components/providers/AuthProvider";

const display = Archivo({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600", "700", "800", "900"],
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://lipids.co";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Lipids — Engineered for Human Skin",
    template: "%s — Lipids",
  },
  description:
    "Lipids is a biotechnology skincare company engineering barrier-replenishing formulas from bio-identical lipids. Engineered for human skin.",
  keywords: ["lipids", "skincare", "barrier repair", "ceramides", "biotech skincare"],
  openGraph: {
    title: "Lipids — Engineered for Human Skin",
    description:
      "A biotechnology skincare company engineering barrier-replenishing formulas from bio-identical lipids.",
    url: siteUrl,
    siteName: "Lipids",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lipids — Engineered for Human Skin",
    description: "Engineered for human skin.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <AuthProvider>
          <Header />
          <main className="pt-20">{children}</main>
          <Footer />
          <CartDrawer />
        </AuthProvider>
      </body>
    </html>
  );
}
