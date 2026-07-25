import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, type Mock } from "vitest";
import { renderApp, setupAppTest } from "../testUtils";

describe("AddMachineCard", () => {
  setupAppTest();

  it("creates an auth key and shows the enrollment command", async () => {
    const fetchMock = globalThis.fetch as unknown as Mock;
    fetchMock.mockImplementation((url: string) => {
      if (url === `${window.location.origin}/authkeys`) {
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
      expect(fetchMock.mock.calls.some(([url]) => url === `${window.location.origin}/authkeys`)).toBe(true),
    );

    // The plaintext key is returned once, so the UI must surface it in a
    // command the operator can run as-is.
    const command = await screen.findByText(/spectre-agent up --host .* --authkey sk_testkey123/);
    expect(command).toBeInTheDocument();
  });
});
