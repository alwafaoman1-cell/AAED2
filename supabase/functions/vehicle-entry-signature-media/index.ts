import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { createSignatureMediaHandler } from "./handler.ts";

Deno.serve(createSignatureMediaHandler(createClient, (key) => Deno.env.get(key)));
