import "./globals.css";

export const metadata = {
  title: "NOVA SCANNER — DexScreener Token Intelligence",
  description: "Real-time Solana meme coin scanner powered by DexScreener API. Token discovery, boost tracking, and AI-ready data exports.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
