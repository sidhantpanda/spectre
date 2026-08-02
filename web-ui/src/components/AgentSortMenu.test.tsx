import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentSortMenu } from "./AgentSortMenu";

describe("AgentSortMenu", () => {
  it("shows the current sort and offers all four orders", () => {
    render(<AgentSortMenu value="name-asc" onChange={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: /sort: name \(a–z\)/i });
    fireEvent.click(trigger);

    expect(screen.getAllByRole("menuitemradio").map((el) => el.textContent)).toEqual([
      "Name (A–Z)",
      "Name (Z–A)",
      "Recently seen",
      "Earliest seen",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Name (A–Z)" })).toHaveAttribute("aria-checked", "true");
  });

  it("reports the chosen sort and closes", () => {
    const onChange = vi.fn();
    render(<AgentSortMenu value="name-asc" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /sort:/i }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Recently seen" }));

    expect(onChange).toHaveBeenCalledWith("last-seen-desc");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("closes on Escape and on a click outside", () => {
    render(<AgentSortMenu value="name-asc" onChange={vi.fn()} />);
    const trigger = screen.getByRole("button", { name: /sort:/i });

    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    fireEvent.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});
