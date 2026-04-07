import "~/styles/globals.css";

import { type Metadata, type Viewport } from "next";
import { Inter, Manrope } from "next/font/google";

import { ORPCReactProvider } from "~/orpc/react";
import { ThemeProvider } from "~/components/theme-provider";
import { ThemeApplier } from "~/components/theme-applier";
import { RecordingOverlay } from "~/components/recording-overlay";

export const metadata: Metadata = {
  title: "AluNotes Bridge",
  description: "Bluetooth A2DP audio bridge control plane",
  icons: [{ rel: "icon", url: "/favicon.svg" }],
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AluNotes",
  },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`} suppressHydrationWarning>
      <body className="font-sans antialiased bg-background text-foreground transition-colors duration-300">
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange={false}
        >
          <ORPCReactProvider>
            <ThemeApplier />
            <RecordingOverlay />
            {children}
          </ORPCReactProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
