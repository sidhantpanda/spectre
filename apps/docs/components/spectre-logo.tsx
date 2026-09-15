import { Terminal } from "lucide-react";
export function SpectreLogo() {
  return (
    <span className="spectre-logo">
      <span className="logo-mark">
        <Terminal size={19} />
      </span>
      <strong>spectre</strong>
      <span className="logo-label">/ docs</span>
    </span>
  );
}
