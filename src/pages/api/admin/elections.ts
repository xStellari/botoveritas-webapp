import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
);

export default async function handler(req, res) {
  if (req.method === "POST") {
    const { title, description, start_date, end_date } = req.body;

    const { data, error } = await supabase
      .from("elections")
      .insert([{ title, description, start_date, end_date, is_active: true }]);

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  }

  if (req.method === "GET") {
    const { data, error } = await supabase
      .from("elections")
      .select("*");

    if (error) return res.status(400).json({ error: error.message });
    return res.status(200).json({ data });
  }

  res.status(405).json({ error: "Method not allowed" });
}
