import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Terminal,
  Network,
  ShieldCheck,
  RefreshCw,
  GitFork,
  Box,
  Server,
  Laptop,
  ChevronRight,
} from "lucide-react";

const guides = [
  {
    number: "01",
    icon: Box,
    title: "Deploy the control plane",
    text: "Three containers. One published port. Start with the supplied Docker Compose stack.",
    href: "/docs/getting-started/quick-start",
    label: "Install Spectre",
  },
  {
    number: "02",
    icon: Server,
    title: "Bring a machine online",
    text: "Install the Go agent, approve its enrollment, and let it dial out. No inbound port required.",
    href: "/docs/reference/agent",
    label: "Enroll an agent",
  },
  {
    number: "03",
    icon: ShieldCheck,
    title: "Make it production-ready",
    text: "Terminate TLS, protect your admin password, back up state, and own the trust boundary.",
    href: "/docs/operations/production",
    label: "Read the runbook",
  },
];
const features = [
  {
    icon: Network,
    title: "Works behind your firewall",
    text: "Agents initiate outbound WebSocket connections. Reach your home lab, VPS, or Pi without opening a port on the target.",
  },
  {
    icon: RefreshCw,
    title: "Pick up where you left off",
    text: "With tmux installed, your session survives a disconnect. Close the tab on your phone. Reattach from your laptop.",
  },
  {
    icon: Terminal,
    title: "A small, inspectable stack",
    text: "A Go agent, a TypeScript server, a React UI, and SQLite. Read the source, build the binaries, and run it yourself.",
  },
];

export default function HomePage() {
  return (
    <main className="spectre-home">
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="status-dot" /> SELF-HOSTED / OPEN SOURCE / MIT
          </div>
          <h1>
            Your infrastructure.
            <br />
            <span>One browser tab.</span>
          </h1>
          <p className="lede">
            A terminal on every machine you own. Reach your servers, home lab,
            and Raspberry Pis from any browser. Your machines. Your control
            plane.
          </p>
          <div className="actions">
            <Link
              className="button primary"
              href="/docs/getting-started/quick-start"
            >
              Deploy Spectre <ArrowRight size={17} />
            </Link>
            <a
              className="button secondary"
              href="https://github.com/sidhantpanda/spectre"
            >
              <GitFork size={17} /> Explore the source
            </a>
          </div>
          <div className="hero-notes">
            <span>Docker Compose</span>
            <span>Outbound-only agents</span>
            <span>tmux persistence</span>
          </div>
        </div>
        <div className="terminal-window">
          <div className="window-bar">
            <span className="traffic">
              <i />
              <i />
              <i />
            </span>
            <span>homelab-nuc — browser terminal</span>
            <Terminal size={14} />
          </div>
          <div className="terminal-body">
            <div className="terminal-context">
              <span className="status-dot" /> CONNECTED <span>WSS / tmux</span>
            </div>
            <pre>
              <code>
                <span className="term-prompt">root@homelab-nuc</span>{" "}
                <span className="term-dim">~ #</span> docker ps{`\n\n`}
                <span className="term-dim">NAMES STATUS</span>
                {`\n`}app-web Up 3 hours{`\n`}app-database Up 3 hours{`\n`}
                app-grafana Up 2 days{`\n\n`}
                <span className="term-prompt">root@homelab-nuc</span>{" "}
                <span className="term-dim">~ #</span> uname -sm{`\n`}Linux
                x86_64{`\n\n`}
                <span className="term-prompt">root@homelab-nuc</span>{" "}
                <span className="term-dim">~ #</span>{" "}
                <span className="cursor">▊</span>
              </code>
            </pre>
          </div>
          <div className="terminal-footer">
            <span>Illustrative session</span>
            <span>YOUR HOST. A REAL SHELL.</span>
          </div>
        </div>
      </section>
      <div className="stack-strip">
        <div className="wrap">
          <span>SMALL STACK. FULL ACCESS.</span>
          <span>Go agent</span>
          <span>WebSockets</span>
          <span>Node.js</span>
          <span>SQLite</span>
          <span>React + xterm.js</span>
        </div>
      </div>
      <section className="section wrap">
        <div className="section-heading">
          <div>
            <p className="eyebrow">BOOTSTRAP / CONNECT / OPERATE</p>
            <h2>From fresh host to first shell.</h2>
          </div>
          <p>
            A straightforward install, with the moving parts explained. Know
            what runs before you run it.
          </p>
        </div>
        <div className="guide-grid">
          {guides.map(({ number, icon: Icon, title, text, href, label }) => (
            <Link className="guide-card" href={href} key={number}>
              <div className="card-top">
                <Icon size={23} />
                <span>{number}</span>
              </div>
              <h3>{title}</h3>
              <p>{text}</p>
              <span className="card-link">
                {label}
                <ArrowRight size={16} />
              </span>
            </Link>
          ))}
        </div>
      </section>
      <section className="section product-section">
        <div className="wrap">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE VIEW FROM YOUR BROWSER</p>
              <h2>Meet your machines.</h2>
            </div>
            <p>
              See connected agents, host information, and Docker containers.
              Choose a machine and open a terminal.
            </p>
          </div>
          <figure className="product-shot">
            <div className="window-bar">
              <span>
                <span className="status-dot" /> Spectre control panel
              </span>
              <span>Actual product screenshot</span>
            </div>
            <Image
              src="/control-server.png"
              alt="Spectre control panel showing an enrolled homelab NUC, system and network information, Docker containers, and connection status."
              width={3200}
              height={2240}
              sizes="(max-width: 1200px) 94vw, 1160px"
            />
            <figcaption>
              The self-hosted dashboard. Your hosts and container details stay
              on your infrastructure.
            </figcaption>
          </figure>
        </div>
      </section>
      <section className="section wrap architecture-section">
        <div>
          <p className="eyebrow">UNDER THE HOOD</p>
          <h2>
            One public endpoint.
            <br />
            Agents dial out.
          </h2>
          <p className="section-copy">
            The proxy sends <code>/api/*</code> to the control server and serves
            the UI on the same origin. Each enrolled agent connects outbound
            using its own device key.
          </p>
          <Link className="text-link" href="/docs/getting-started/architecture">
            Trace the connection <ArrowRight size={16} />
          </Link>
        </div>
        <div
          className="topology"
          aria-label="A browser connects to the reverse proxy over HTTPS. Agents dial out over WSS. The proxy routes API traffic to the control server and other requests to the web UI."
        >
          <div className="topology-row">
            <div className="node">
              <Laptop />
              <strong>Browser</strong>
              <small>HTTPS / ticket auth</small>
            </div>
            <span className="wire">↔</span>
            <div className="node">
              <Server />
              <strong>Reverse proxy</strong>
              <small>TLS / one port</small>
            </div>
            <span className="wire">←</span>
            <div className="node">
              <Terminal />
              <strong>Go agent</strong>
              <small>WSS / device key</small>
            </div>
          </div>
          <div className="topology-backend">
            <span>{"/api/* → control server + SQLite"}</span>
            <span>{"/* → static web UI"}</span>
          </div>
          <p>
            <span className="status-dot" /> No listening port on the agent host
          </p>
        </div>
      </section>
      <section className="section wrap feature-grid">
        {features.map(({ icon: Icon, title, text }) => (
          <article key={title}>
            <Icon size={24} />
            <h3>{title}</h3>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="section wrap">
        <div className="operator-panel">
          <div>
            <p className="eyebrow">WITH ROOT ACCESS COMES RESPONSIBILITY</p>
            <h2>
              Your bastion.
              <br />
              Your trust boundary.
            </h2>
            <p>
              One admin password grants shell access to every enrolled machine.
              Use TLS, protect credentials, and revoke machines you no longer
              own.
            </p>
          </div>
          <div className="runbook-links">
            <Link href="/docs/operations/production">
              <ShieldCheck /> Production checklist <ChevronRight />
            </Link>
            <Link href="/docs/operations/maintenance">
              <RefreshCw /> Upgrades & backups <ChevronRight />
            </Link>
            <Link href="/docs/operations/troubleshooting">
              <Network /> Connection troubleshooting <ChevronRight />
            </Link>
            <Link href="/docs/reference/server">
              <Server /> Configuration & API <ChevronRight />
            </Link>
          </div>
        </div>
      </section>
      <section className="section wrap final-section">
        <div>
          <p className="eyebrow">BUILT IN THE OPEN</p>
          <h2>Read it. Run it. Make it yours.</h2>
          <p>
            Spin up the development stack, inspect the wire protocol, or send
            your first contribution.
          </p>
        </div>
        <div className="actions">
          <Link className="button primary" href="/docs/development/local">
            Start developing <ArrowRight size={17} />
          </Link>
          <Link className="button secondary" href="/docs">
            Browse the docs
          </Link>
        </div>
      </section>
      <footer className="wrap footer">
        <span>
          spectre{" "}
          <span className="term-dim">
            / a terminal on every machine you own.
          </span>
        </span>
        <a href="https://github.com/sidhantpanda/spectre/blob/main/LICENSE">
          MIT licensed ↗
        </a>
      </footer>
    </main>
  );
}
