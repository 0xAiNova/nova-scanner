import "./globals.css";
import { Inter } from "next/font/google";

const inter = Inter({ subsets: ["latin"] });

export const metadata = {
  title: "Nova Scanner — DexScreener Token Intelligence",
  description: "Real-time multi-chain token scanner powered by DexScreener. AI-agent-ready JSON API with scoring, risk flags, and action recommendations.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
