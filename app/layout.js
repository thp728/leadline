import "./globals.css";

export const metadata = {
  title: "leadline",
  description: "Personal lead pipeline for founder-led outreach",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
