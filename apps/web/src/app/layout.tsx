import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "sonner";
import { ConvexClientProvider } from "@/components/convex-provider";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Interpreter — Real-Time Translation for Google Meet",
  description:
    "Hear every participant in your language. Real-time speech translation and dubbing for Google Meet calls.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="min-h-screen bg-surface-bg antialiased">
        <ConvexClientProvider>
          {children}
        </ConvexClientProvider>
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
