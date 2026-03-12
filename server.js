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

    const { data: medicines } = await supabase
      .from("medicines")
      .select("*")
      .ilike("name", `%${name}%`);

    if (!medicines || medicines.length === 0) {
      return res.json([]);
    }

    const results = [];

    for (const medicine of medicines) {

      const { data: pharmacyMedicines } = await supabase
        .from("pharmacy_medicines")
        .select("*")
        .eq("medicine_id", medicine.id);

      for (const item of pharmacyMedicines) {

        const { data: pharmacy } = await supabase
          .from("pharmacies")
          .select("*")
          .eq("id", item.pharmacy_id)
          .single();

        if (!pharmacy) continue;

        let status_open = "unknown";

        if (pharmacy.opening_time && pharmacy.closing_time) {

          const now = new Date().getHours();

          const openHour = parseInt(pharmacy.opening_time.split(":")[0]);
          const closeHour = parseInt(pharmacy.closing_time.split(":")[0]);

          status_open = (now >= openHour && now < closeHour) ? "open" : "closed";

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

          status_open,

          medicine_id: medicine.id,
          medicine_name: medicine.name,
          medicine_description: medicine.description,

          price: item.price,
          stock: item.stock

        });

      }

    }

    res.json(results);

  } catch (error) {

    console.error("SEARCH ERROR:", error);
    res.status(500).json({ error: "Search error" });

  }

});

app.get("/api/search-list", async (req, res) => {

  try {

    const medicinesParam = req.query.medicines;

    if (!medicinesParam) {
      return res.json([]);
    }

    const medicineNames = medicinesParam
      .split(",")
      .map(m => m.trim().toLowerCase());

    const { data: pharmacies, error: pharmError } = await supabase
      .from("pharmacies")
      .select("*");

    if (pharmError) throw pharmError;

    const results = [];

    for (const pharmacy of pharmacies) {

      let hasAllMedicines = true;

      for (const name of medicineNames) {

        /* chercher tous les médicaments correspondants */

        const { data: meds, error: medError } = await supabase
          .from("medicines")
          .select("id,name")
          .ilike("name", `%${name}%`);

        if (medError || !meds || meds.length === 0) {

          hasAllMedicines = false;
          break;

        }

        const medIds = meds.map(m => m.id);

        /* vérifier si la pharmacie possède un de ces médicaments */

        const { data: pm } = await supabase
          .from("pharmacy_medicines")
          .select("id")
          .eq("pharmacy_id", pharmacy.id)
          .in("medicine_id", medIds)
          .limit(1);

        if (!pm || pm.length === 0) {

          hasAllMedicines = false;
          break;

        }

      }

      if (hasAllMedicines) {

        results.push(pharmacy);

      }

    }

    res.json(results);

  } catch (error) {

    console.error("SEARCH LIST ERROR:", error);
    res.status(500).json({ error: "Search list error" });

  }

});

app.get("/api/search-prescription", async (req, res) => {

  res.json([
    {
      detected_medicines: "paracetamol,doliprane",
      search_url: "/api/search-list?medicines=paracetamol,doliprane"
    }
  ]);

});

app.post("/api/search-prescription", upload.single("image"), async (req, res) => {

  try {

    if (!req.file) {
      return res.status(400).json({ error: "No image uploaded" });
    }

    const base64 = req.file.buffer.toString("base64");

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "List only the medicine names from this prescription separated by commas."
            },
            {
              type: "input_image",
              image_url: `data:image/jpeg;base64,${base64}`
            }
          ]
        }
      ]
    });

    const text = response.output_text;

    const medicines = text
      .split(",")
      .map(m => m.trim())
      .filter(m => m !== "");

    res.json({
      detected_medicines: medicines,
      search_api: `/api/search-list?medicines=${medicines.join(",")}`
    });

  } catch (error) {

    console.error("PRESCRIPTION ERROR:", error);
    res.status(500).json({ error: "Prescription analysis error" });

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
   CREATE ORDER (MULTIPLE MEDICINES)
-------------------------- */

app.post("/api/orders", async (req, res) => {

  try {

    const { user_name, phone, pharmacy_id, items } = req.body;

    if (!user_name || !phone || !pharmacy_id || !items || items.length === 0) {
      return res.status(400).json({ error: "Missing order data" });
    }

    let total_amount = 0;
    const orderItems = [];

    for (const item of items) {

      const { medicine_id, quantity } = item;

      if (!medicine_id || !quantity) {
        return res.status(400).json({ error: "Invalid item data" });
      }

      /* vérifier si la pharmacie possède ce médicament */

      const { data: pharmacyMedicine, error } = await supabase
        .from("pharmacy_medicines")
        .select("*")
        .eq("pharmacy_id", pharmacy_id)
        .eq("medicine_id", medicine_id)
        .single();

      if (error || !pharmacyMedicine) {
        return res.status(400).json({
          error: `Medicine ${medicine_id} not available in this pharmacy`
        });
      }

      const price = pharmacyMedicine.price;
      const subtotal = price * quantity;

      total_amount += subtotal;

      orderItems.push({
        medicine_id,
        quantity,
        price
      });

    }

    /* créer la commande */

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

    /* créer les order_items */

    const itemsToInsert = orderItems.map(item => ({
      order_id: order.id,
      medicine_id: item.medicine_id,
      quantity: item.quantity,
      price: item.price
    }));

    const { error: itemsError } = await supabase
      .from("order_items")
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    res.json({
      success: true,
      order_id: order.id,
      total_amount
    });

  } catch (error) {

    console.error("ORDER ERROR:", error);
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