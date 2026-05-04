import { useCallback, useState } from "react";
import { NAME_KEY } from "../lib/format";

export function useMyName() {
  const [name, setNameState] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(NAME_KEY) ?? "";
  });
  const setName = useCallback((next: string | null) => {
    if (next == null || next.trim() === "") {
      localStorage.removeItem(NAME_KEY);
      setNameState("");
    } else {
      const trimmed = next.trim().slice(0, 30);
      localStorage.setItem(NAME_KEY, trimmed);
      setNameState(trimmed);
    }
  }, []);
  return [name, setName] as const;
}
