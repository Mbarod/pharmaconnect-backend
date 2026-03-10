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

    if (!name || name.trim() === "") {
      return res.json([]);
    }

    const { data: pm, error } = await supabase
      .from("pharmacy_medicines")
      .select("*")
      .limit(20);

    if (error) throw error;

    const results = [];

    for (const item of pm) {

      const { data: pharmacy } = await supabase
        .from("pharmacies")
        .select("*")
        .eq("id", item.pharmacy_id)
        .single();

      const { data: medicine } = await supabase
        .from("medicines")
        .select("*")
        .eq("id", item.medicine_id)
        .single();

      if (!pharmacy || !medicine) continue;

      if (name && !medicine.name.toLowerCase().includes(name.toLowerCase())) continue;

      /* ----------- CALCUL OPEN / CLOSED ----------- */

      let status_open = "unknown";

      if (pharmacy.opening_time && pharmacy.closing_time) {

        const now = new Date();

        const hour = now.getHours();

        const openHour = parseInt(pharmacy.opening_time.split(":")[0]);
        const closeHour = parseInt(pharmacy.closing_time.split(":")[0]);

        status_open = (hour >= openHour && hour < closeHour) ? "open" : "closed";

      }

results.push({

  pharmacy_id: pharmacy.id,
  pharmacy_name: pharmacy.name,
  pharmacy_city: pharmacy.city,
  pharmacy_address: pharmacy.address,

  pharmacy_phone: pharmacy.phone,

  pharmacy_latitude: pharmacy.latitude,
  pharmacy_longitude: pharmacy.longitude,

  opening_time: pharmacy.opening_time,
  closing_time: pharmacy.closing_time,

  status_open: status_open,

  medicine_id: medicine.id,
  medicine_name: medicine.name,
  medicine_description: medicine.description,

  price: item.price,
  stock: item.stock

});

}

res.json(results);

} catch (err) {

console.error("SEARCH ERROR:", err);
res.status(500).json({ error: "Search error" });

}
});

/* -------------------------
   GET ALL PHARMACIES
-------------------------- */

app.get("/api/pharmacies", async (req, res) => {

  try {

    const { data, error } = await supabase
      .from("pharmacies")
      .select("*");

    if (error) throw error;

    const results = data.map(pharmacy => {

      let status_open = "unknown";

      if (pharmacy.opening_time && pharmacy.closing_time) {

        const now = new Date();
        const hour = now.getHours();

        const openHour = parseInt(pharmacy.opening_time.split(":")[0]);
        const closeHour = parseInt(pharmacy.closing_time.split(":")[0]);

        status_open = (hour >= openHour && hour < closeHour)
          ? "open"
          : "closed";
      }

      return {
        ...pharmacy,
        status_open
      };

    });

    res.json(results);

  } catch (error) {

    console.error(error);
    res.status(500).json({ error: "Pharmacies fetch error" });

  }

});


/* -------------------------
   GET ONE PHARMACY
-------------------------- */

app.get("/api/pharmacies/:id", async (req, res) => {

  try {

    const id = req.params.id;

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