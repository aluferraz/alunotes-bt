import "~/styles/globals.css";

import { type Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { ORPCReactProvider } from "~/orpc/react";

export const metadata: Metadata = {
  title: "AluNotes Bridge",
  description: "Bluetooth A2DP audio bridge control plane",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} dark`}>
      <body>
        <ORPCReactProvider>{children}</ORPCReactProvider>
      </body>
    </html>
  );
}
