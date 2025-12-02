// src/api/admin/voters.ts
import { createClient } from "@supabase/supabase-js";

// Create a Supabase client with the service role key (backend only)
const supabase = createClient(
  process.env.SUPABASE_URL!,             // your Supabase project URL
  process.env.SUPABASE_SERVICE_ROLE_KEY! // service role key from .env
);

// Express-style handler
export async function votersHandler(req: any, res: any) {
  if (req.method === "POST") {
    const {
      email,
      first_name,
      middle_name,
      last_name,
      org_affiliations,
      rfid_tag,
      face_descriptor,
      year_level,
    } = req.body;

    const { data, error } = await supabase
      .from("voters")
      .insert([
        {
          email,
          first_name,
          middle_name,
          last_name,
          org_affiliations,
          rfid_tag,
          face_descriptor,
          year_level,
        },
      ]);

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(200).json({ data });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase.from("voters").select("*");

    if (error) {
      return res.status(400).json({ error: error.message });
    }
    return res.status(200).json({ data });
  }

  return res.status(405).json({ error: "Method not allowed" });
}
