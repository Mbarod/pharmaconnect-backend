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
const verifyApiKey = async (req, res, next) => {
  const apiKey = req.headers.authorization?.replace("Bearer ", "");

  if (!apiKey) {
    return res.status(401).json({ error: "API key required" });
  }

  const { data, error } = await supabase
    .from("pharmacies")
    .select("*")
    .eq("api_key", apiKey)
    .single();

  if (error || !data) {
    return res.status(403).json({ error: "Invalid API key" });
  }

  req.pharmacy = data;
  next();
};
app.post("/api/sync-stock", verifyApiKey, async (req, res) => {
  try {
    const { pharmacy_id, stocks } = req.body;

    if (!pharmacy_id || !stocks) {
      return res.status(400).json({ error: "Missing data" });
    }

    for (const item of stocks) {
      await supabase
        .from("medicines")
        .update({ stock: item.stock })
        .eq("name", item.name);
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Stock sync error" });
  }
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
app.get("/api/orders", verifyApiKey, async (req, res) => {
  const pharmacy_id = req.pharmacy.id;

  const { data } = await supabase
    .from("orders")
    .select("*")
    .eq("pharmacy_id", pharmacy_id)
    .eq("status", "pending");

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

/* -------------------------
   SEARCH MEDICINE
-------------------------- */
app.get("/api/search", async (req, res) => {
  try {
    const { name } = req.query;

    const { data, error } = await supabase
      .from("pharmacy_medicines")
      .select(`
        price,
        stock,
        pharmacies(name, city, address),
        medicines(name, description, image_url)
      `)
      .ilike("medicines.name", `%${name}%`);

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Search error" });
  }
});
/* -------------------------
   GET ORDERS
-------------------------- */
app.get("/api/orders/:pharmacy_id", async (req, res) => {
  try {
    const { pharmacy_id } = req.params;

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("pharmacy_id", pharmacy_id)
      .eq("status", "pending");

    if (error) throw error;

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Orders fetch error" });
  }
});
app.post("/api/create-order", async (req, res) => {
  try {

    if (!req.body) {
      return res.status(400).json({ error: "No body received" });
    }

    const {
      user_name,
      phone,
      pharmacy_id,
      medicine_id,
      total_amount
    } = req.body;

    // 1️⃣ Create order
    const { data: order, error: orderError } = await supabase
      .from("orders")
      .insert([
        {
          user_name,
          phone,
          pharmacy_id,
          total_amount,
          status: "pending"
        }
      ])
      .select()
      .single();

    if (orderError) throw orderError;

    // 2️⃣ Create order item
    const { error: itemError } = await supabase
      .from("order_items")
      .insert([
        {
          order_id: order.id,
          medicine_id,
          quantity: 1,
          price: total_amount
        }
      ]);

    if (itemError) throw itemError;

    res.json({ success: true, order_id: order.id });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Order creation error" });
  }
});
/* -------------------------
   START SERVER
-------------------------- */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`PharmaConnect API running on port ${PORT}`);
});