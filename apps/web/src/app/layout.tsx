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
        {/* Top right, because the upload queue occupies the bottom right and a toast
            landing on top of a progress bar hides the thing it is commenting on. */}
        <Toaster position="top-right" />
      </body>
    </html>
  );
}
