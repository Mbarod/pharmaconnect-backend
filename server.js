require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");
const multer = require("multer");

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const upload = multer({ storage: multer.memoryStorage() });

/* -------------------------
   GET MEDICINES
-------------------------- */
app.get("/api/medicines", async (req, res) => {
  const { data, error } = await supabase
    .from("medicines")
    .select("*");

  if (error) return res.status(400).json(error);
  res.json(data);
});

/* -------------------------
   CREATE ORDER
-------------------------- */
app.post("/api/orders", async (req, res) => {
  const { user_name, phone, pharmacy_id, total_amount } = req.body;

  const { data, error } = await supabase
    .from("orders")
    .insert([{ user_name, phone, pharmacy_id, total_amount }]);

  if (error) return res.status(400).json(error);
  res.json(data);
});

/* -------------------------
   UPLOAD PRESCRIPTION
-------------------------- */
app.post("/api/upload-prescription", upload.single("file"), async (req, res) => {
  const file = req.file;
  const fileName = `${Date.now()}-${file.originalname}`;

  const { data, error } = await supabase.storage
    .from("prescriptions")
    .upload(fileName, file.buffer);

  if (error) return res.status(400).json(error);

  res.json({ file_url: data.path });
});

/* -------------------------
   AGENT IA
-------------------------- */
app.post("/api/agent", async (req, res) => {
  const { message } = req.body;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "Tu es Pharmaconnect Gabon, assistant pharmacie." },
      { role: "user", content: message }
    ]
  });

  res.json({ reply: completion.choices[0].message.content });
});
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`PharmaConnect API running on port ${PORT}`);
});
