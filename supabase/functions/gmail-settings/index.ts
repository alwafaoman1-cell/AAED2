import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createGmailSettingsHandler } from "./handler.ts";

Deno.serve(createGmailSettingsHandler({ createClient, env: name => Deno.env.get(name) }));
