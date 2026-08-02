import { useEffect, useState } from "react";
import { DEFAULT_AGENT_SORT, isAgentSort, type AgentSort } from "../state/agents";

const STORAGE_KEY = "agent-sort-preference";

function getInitialSort(): AgentSort {
  if (typeof window === "undefined") return DEFAULT_AGENT_SORT;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  // Anything else — an older value, a hand-edited one — falls back rather than
  // leaving the list in an order the menu cannot show as selected.
  return isAgentSort(stored) ? stored : DEFAULT_AGENT_SORT;
}

/** The machine list's sort order, remembered across reloads like the theme is. */
export function useAgentSort() {
  const [sort, setSort] = useState<AgentSort>(getInitialSort);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, sort);
  }, [sort]);

  return [sort, setSort] as const;
}
