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
   HEALTH CHECK
-------------------------- */

app.get("/", (req, res) => {
  res.json({ status: "PharmaConnect API running" });
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

    console.error("API KEY ERROR:", error);
    res.status(500).json({ error: "Auth error" });

  }

};

/* -------------------------
   GET MEDICINES
-------------------------- */

app.get("/api/medicines", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("medicines")
      .select("*")
      .limit(100);

    if (error) throw error;

    res.json(data);

  } catch (error) {

    console.error("MEDICINES ERROR:", error);
    res.status(500).json({ error: "Medicines fetch error" });

  }

});

/* -------------------------
   SEARCH MEDICINE
-------------------------- */

app.get("/api/search", async (req, res) => {

  try {

    const name = req.query.name;

if (!name) {
  const { data } = await supabase
    .from("pharmacy_medicines")
    .select(`
      price,
      stock,
      pharmacies(id,name,city,address),
      medicines(id,name,description,image_url)
    `)
    .limit(5);

  const results = data.map(item => ({
    pharmacy_id: item.pharmacies.id,
    pharmacy_name: item.pharmacies.name,
    pharmacy_city: item.pharmacies.city,

    medicine_id: item.medicines.id,
    medicine_name: item.medicines.name,

    price: item.price,
    stock: item.stock
  }));

  return res.json(results);
}

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

    console.error("MEDICINE PHARMACIES ERROR:", error);
    res.status(500).json({ error: "Pharmacy fetch error" });

  }

});

/* -------------------------
   GET ALL PHARMACIES
-------------------------- */

app.get("/api/pharmacies", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("pharmacies")
      .select("*")
      .limit(100);

    if (error) throw error;

    res.json(data);

  } catch (error) {

    console.error("PHARMACIES ERROR:", error);
    res.status(500).json({ error: "Pharmacies fetch error" });

  }

});

/* -------------------------
   GET ONE PHARMACY
-------------------------- */

app.get("/api/pharmacy/:id", async (req, res) => {

  try {

    const { id } = req.params;

    const { data, error } = await supabase
      .from("pharmacies")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      return res.status(404).json({ error: "Pharmacy not found" });
    }

    res.json(data);

  } catch (error) {

    console.error("PHARMACY ERROR:", error);
    res.status(500).json({ error: "Pharmacy fetch error" });

  }

});

/* -------------------------
   CREATE ORDER
-------------------------- */

app.post("/api/orders", async (req, res) => {

  try {

    const { user_name, phone, pharmacy_id, medicine_id, total_amount } = req.body;

    if (!user_name || !phone || !pharmacy_id || !medicine_id) {
      return res.status(400).json({ error: "Missing order data" });
    }

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

    console.error("ORDER ERROR:", error);
    res.status(500).json({ error: "Order creation error" });

  }

});

/* -------------------------
   PUBLIC ORDERS (ADALO TEST)
-------------------------- */

app.get("/api/orders-public", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .limit(20);

    if (error) throw error;

    res.json(data);

  } catch (error) {

    console.error("ORDERS PUBLIC ERROR:", error);
    res.status(500).json({ error: "Orders fetch error" });

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
      .eq("pharmacy_id", pharmacy_id);

    if (error) throw error;

    res.json(data);

  } catch (error) {

    console.error("ORDERS ERROR:", error);
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

    console.error("STATUS UPDATE ERROR:", error);
    res.status(500).json({ error: "Status update error" });

  }

});

/* -------------------------
   SERVER
-------------------------- */

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(`PharmaConnect API running on port ${PORT}`);

});