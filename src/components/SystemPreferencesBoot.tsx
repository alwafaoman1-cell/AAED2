import { useSystemPreferences } from "@/lib/systemPreferences";

export default function SystemPreferencesBoot() {
  useSystemPreferences();
  return null;
}

