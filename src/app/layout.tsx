import type { Metadata } from "next";
import { Nunito, Fredoka, Geist_Mono } from "next/font/google";
import "./globals.css";
import '@/lib/three-compat';
import { Providers } from "./providers";

// Body — friendly, rounded sans
const nunito = Nunito({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

// Display — playful, bubbly headings & branding
const fredoka = Fredoka({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Avatar Studio — 나만의 귀여운 아바타 만들기",
  description: "발랄하고 귀여운 3D 아바타를 만드는 캐릭터 스튜디오",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${nunito.variable} ${fredoka.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
