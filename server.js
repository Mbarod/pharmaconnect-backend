require("dotenv").config();

const express = require("express");
const cors = require("cors");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

/* -------------------------
   SUPABASE
-------------------------- */

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

/* -------------------------
   OPENAI
-------------------------- */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/* -------------------------
   FILE UPLOAD
-------------------------- */

const upload = multer({
  storage: multer.memoryStorage()
});

/* -------------------------
   API KEY MIDDLEWARE
-------------------------- */

const verifyApiKey = async (req, res, next) => {

  try {

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

  } catch (error) {

    res.status(500).json({ error: "Auth error" });

  }

};

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
        pharmacies(id,name,city,address),
        medicines(id,name,description,image_url)
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
   PHARMACIES PAR MEDICAMENT
-------------------------- */

app.get("/api/medicine-pharmacies/:medicine_id", async (req, res) => {

  try {

    const { medicine_id } = req.params;

    const { data, error } = await supabase
      .from("pharmacy_medicines")
      .select(`
        price,
        stock,
        pharmacies(id,name,address,city),
        medicines(name)
      `)
      .eq("medicine_id", medicine_id);

    if (error) throw error;

    res.json(data);

  } catch (error) {

    console.error(error);

    res.status(500).json({ error: "Pharmacy fetch error" });

  }

});

/* -------------------------
   PHARMACY DETAILS
-------------------------- */

app.get("/api/pharmacy/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const { data, error } = await supabase
      .from("pharmacies")
      .select("*")
      .eq("id", id)
      .single();

    if (error) throw error;

    res.json(data);

  } catch (error) {

    console.error(error);

    res.status(500).json({ error: "Pharmacy fetch error" });

  }

});

/* -------------------------
   CREATE ORDER
-------------------------- */

app.post("/api/orders", async (req, res) => {

  try {

    const { user_name, phone, pharmacy_id, medicine_id, total_amount } = req.body;

    const { data: order, error } = await supabase
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

    if (error) throw error;

    await supabase
      .from("order_items")
      .insert([
        {
          order_id: order.id,
          medicine_id,
          quantity: 1,
          price: total_amount
        }
      ]);

    res.json({
      success: true,
      order_id: order.id
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({ error: "Order creation error" });

  }

});

/* -------------------------
   GET ORDERS PHARMACY
-------------------------- */

app.get("/api/orders", verifyApiKey, async (req, res) => {

  try {

    const pharmacy_id = req.pharmacy.id;

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("pharmacy_id", pharmacy_id)
      .eq("status", "pending");

    if (error) throw error;

    res.json(data);

  } catch (error) {

    res.status(500).json({ error: "Orders fetch error" });

  }

});

/* -------------------------
   UPDATE ORDER STATUS
-------------------------- */

app.put("/api/order-status/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const { status } = req.body;

    const { data, error } = await supabase
      .from("orders")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    res.json(data);

  } catch (error) {

    res.status(500).json({ error: "Status update error" });

  }

});

/* -------------------------
   CONFIRM ORDER
-------------------------- */

app.get("/api/confirm-order/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const { error } = await supabase
      .from("orders")
      .update({ status: "confirmed" })
      .eq("id", id);

    if (error) throw error;

    res.json({
      success: true,
      order_id: id
    });

  } catch (error) {

    res.status(500).json({ error: "Confirmation error" });

  }

});

/* -------------------------
   SYNC STOCK
-------------------------- */

app.post("/api/sync-stock", verifyApiKey, async (req, res) => {

  try {

    const { stocks } = req.body;

    for (const item of stocks) {

      await supabase
        .from("medicines")
        .update({ stock: item.stock })
        .eq("name", item.name);

    }

    res.json({ success: true });

  } catch (error) {

    res.status(500).json({ error: "Stock sync error" });

  }

});

/* -------------------------
   UPLOAD PRESCRIPTION
-------------------------- */

app.post("/api/upload-prescription", upload.single("file"), async (req, res) => {

  try {

    const file = req.file;

    const fileName = `${Date.now()}-${file.originalname}`;

    const { data, error } = await supabase.storage
      .from("prescriptions")
      .upload(fileName, file.buffer);

    if (error) throw error;

    res.json({ file_url: data.path });

  } catch (error) {

    res.status(500).json({ error: "Upload error" });

  }

});

/* -------------------------
   AI AGENT
-------------------------- */

app.post("/api/agent", async (req, res) => {

  try {

    const { message } = req.body;

    const completion = await openai.chat.completions.create({

      model: "gpt-4o-mini",

      messages: [
        {
          role: "system",
          content: "Tu es Pharmaconnect Gabon assistant pharmacie."
        },
        {
          role: "user",
          content: message
        }
      ]

    });

    res.json({
      reply: completion.choices[0].message.content
    });

  } catch (error) {

    res.status(500).json({ error: "AI error" });

  }

});

/* -------------------------
   SERVER
-------------------------- */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`PharmaConnect API running on port ${PORT}`);

});