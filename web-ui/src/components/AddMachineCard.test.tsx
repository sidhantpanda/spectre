import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, type Mock } from "vitest";
import { renderApp, setupAppTest } from "../testUtils";

describe("AddMachineCard", () => {
  setupAppTest();

  it("creates an auth key and shows the enrollment command", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/api/authkeys`) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "key-1",
              key: "sk_testkey123",
              hint: "sk_test",
              reusable: false,
              createdAt: Date.now(),
              expiresAt: Date.now() + 1000,
              uses: 0,
              revoked: false,
            }),
        }) as unknown as Promise<Response>;
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) }) as unknown as Promise<Response>;
    });

    renderApp();

    fireEvent.click(screen.getByRole("button", { name: /create auth key/i }));

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => url === `${window.location.origin}/api/authkeys`)).toBe(true),
    );

    // The plaintext key is returned once, so the UI must surface it in a
    // command the operator can run as-is. The machine being added has no agent
    // on it yet, so the command installs one before enrolling.
    const command = await screen.findByText(
      /curl -fsSL \S+install-agent\.sh \| sudo SPECTRE_AUTHKEY=sk_testkey123 bash -s -- --host \S+/,
    );
    expect(command).toBeInTheDocument();

    // The key rides in the environment; as a flag it would sit in `ps`.
    expect(command.textContent).not.toMatch(/--authkey/);

    // A machine that already has the agent gets the shorter form.
    expect(
      await screen.findByText(/sudo SPECTRE_AUTHKEY=sk_testkey123 spectre-agent up --host \S+/),
    ).toBeInTheDocument();
  });
});
