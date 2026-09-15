import type { Metadata, Viewport } from "next";
import { RootProvider } from "fumadocs-ui/provider/next";
import { siteUrl } from "@/lib/site-url";
import "./global.css";
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Spectre — Your infrastructure. One browser tab.",
    template: "%s · Spectre",
  },
  description:
    "A self-hosted browser terminal for your servers, home lab, and Raspberry Pis. Deploy with Docker Compose, enroll an agent, and open a shell.",
  applicationName: "Spectre",
  icons: { icon: "/icon.svg" },
  openGraph: {
    type: "website",
    siteName: "Spectre",
    images: ["/og/docs/image.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og/docs/image.png"] },
};
export const viewport: Viewport = {
  themeColor: "#090c10",
  colorScheme: "dark light",
};
export default function Layout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider theme={{ defaultTheme: "dark" }}>{children}</RootProvider>
      </body>
    </html>
  );
}
