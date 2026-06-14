import type { Metadata } from "next";
import { AppShell } from "./components/AppShell";
import { LanguageProvider } from "./lib/i18n/LanguageContext";
import { OfflineQueue } from "./components/OfflineQueue";
import { ServiceWorkerRegistrar } from "./components/ServiceWorkerRegistrar";
import "./styles.css";

export const metadata: Metadata = {
  title: "Commerce POS",
  description: "Commerce and point-of-sale platform",
  manifest: "/manifest.json",
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LanguageProvider>
          <AppShell>{children}</AppShell>
          <OfflineQueue />
        </LanguageProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
