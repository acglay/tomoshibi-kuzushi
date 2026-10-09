import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ともしび くずし",
  description: "ボールが光源の暗闇ブロック崩し。Radiance Cascadesの光と影で、照らしたブロックだけが見える。",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, userScalable: false };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className="h-full">
      <body className="h-full">{children}</body>
    </html>
  );
}
