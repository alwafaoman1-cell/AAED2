import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createUnifiedMessageHandler } from "./handler.ts";

Deno.serve(createUnifiedMessageHandler({ createClient, env: (name) => Deno.env.get(name) }));
