import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { SpectreLogo } from "@/components/spectre-logo";
export function baseOptions(): BaseLayoutProps {
  return {
    nav: { title: <SpectreLogo /> },
    links: [
      { text: "Documentation", url: "/docs" },
      { text: "Quickstart", url: "/docs/getting-started/quick-start" },
      { text: "Operations", url: "/docs/operations/production" },
      { text: "Developers", url: "/docs/development/local" },
    ],
    githubUrl: "https://github.com/sidhantpanda/spectre",
  };
}
