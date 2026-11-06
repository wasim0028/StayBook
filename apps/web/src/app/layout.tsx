import type { Metadata, Viewport } from "next";
import { Footer, Navbar } from "@/components/Navbar";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "StayBook: homes, villas and homestays across India", template: "%s · StayBook" },
  description: "Book unique stays across India, or host your own space. Secure payments with Razorpay.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#131110" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2">
          Skip to content
        </a>
        <Navbar />
        <main id="main">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
