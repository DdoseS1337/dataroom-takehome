import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Providers } from "./providers";
import "./globals.css";

// Instrument Sans rather than the scaffold's Geist: narrower, slightly editorial, and
// it keeps long document names readable in a dense table. Mono is kept for sizes and
// timestamps, where digits need to line up.
const sans = Instrument_Sans({
  // Deliberately not `--font-sans`: that is the Tailwind theme name, and reusing it
  // here makes the variable reference itself. See the comment in globals.css.
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Data Room",
  description: "A virtual data room for M&A due diligence.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
        {/* Pinned: the app has no theme switcher, and sonner's default of "system"
            would render dark toasts over a light UI for anyone on a dark desktop. */}
        <Toaster position="bottom-right" theme="light" />
      </body>
    </html>
  );
}
