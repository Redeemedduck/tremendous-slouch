import { useCallback, useState } from "react";
import { HANDICAP_KEY, NAME_KEY } from "../lib/format";

type Profile = { name: string; handicap: number | null };

const readProfile = (): Profile => {
  if (typeof window === "undefined") return { name: "", handicap: null };
  const name = localStorage.getItem(NAME_KEY) ?? "";
  const rawH = localStorage.getItem(HANDICAP_KEY);
  const handicap = rawH != null && rawH !== "" ? Number(rawH) : null;
  return {
    name,
    handicap: Number.isFinite(handicap) ? (handicap as number) : null,
  };
};

export function useMyProfile() {
  const [profile, setProfileState] = useState<Profile>(readProfile);

  const setProfile = useCallback((next: Partial<Profile> | null) => {
    if (next == null) {
      localStorage.removeItem(NAME_KEY);
      localStorage.removeItem(HANDICAP_KEY);
      setProfileState({ name: "", handicap: null });
      return;
    }
    setProfileState((prev) => {
      const merged: Profile = {
        name: next.name !== undefined ? next.name.trim().slice(0, 30) : prev.name,
        handicap:
          next.handicap !== undefined && next.handicap !== null
            ? Math.round(next.handicap * 10) / 10
            : next.handicap === null
              ? null
              : prev.handicap,
      };
      if (merged.name) localStorage.setItem(NAME_KEY, merged.name);
      else localStorage.removeItem(NAME_KEY);
      if (merged.handicap != null)
        localStorage.setItem(HANDICAP_KEY, String(merged.handicap));
      else localStorage.removeItem(HANDICAP_KEY);
      return merged;
    });
  }, []);

  return [profile, setProfile] as const;
}
