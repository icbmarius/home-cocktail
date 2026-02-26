const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const QRCode = require("qrcode");
require("dotenv").config();

const { all, get, run } = require("./db");
const { requireAdmin } = require("./middleware/admin-auth");

const app = express();
const port = process.env.PORT || 3000;

const publicDir = path.join(process.cwd(), "public");
const configuredUploadDir = (process.env.UPLOAD_DIR || "").trim();
const uploadDir = configuredUploadDir ? path.resolve(configuredUploadDir) : path.join(publicDir, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));

app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

app.use(express.static(publicDir));
app.use("/uploads", express.static(uploadDir));

function deleteImageByPath(imagePath) {
  if (!imagePath) return;
  const fileName = path.basename(imagePath);
  const targetPath = path.join(uploadDir, fileName);
  if (targetPath.startsWith(uploadDir) && fs.existsSync(targetPath)) {
    fs.unlinkSync(targetPath);
  }
}

function normalizeWhatsappNumber(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizeWhatsappAddress(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.toLowerCase().startsWith("whatsapp:")) return raw;
  if (raw.startsWith("+")) return `whatsapp:${raw}`;
  const digits = raw.replace(/[^\d]/g, "");
  return digits ? `whatsapp:+${digits}` : "";
}

function getTwilioConfig() {
  const accountSid = (process.env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = (process.env.TWILIO_AUTH_TOKEN || "").trim();
  const from = normalizeWhatsappAddress(process.env.TWILIO_WHATSAPP_FROM);
  const to = normalizeWhatsappAddress(process.env.TWILIO_WHATSAPP_TO);
  return {
    accountSid,
    authToken,
    from,
    to,
    enabled: Boolean(accountSid && authToken && from && to)
  };
}

async function sendTwilioWhatsappMessage(messageBody) {
  const twilio = getTwilioConfig();
  if (!twilio.enabled) {
    return { sent: false };
  }

  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`;
  const body = new URLSearchParams({
    From: twilio.from,
    To: twilio.to,
    Body: messageBody
  });
  const authValue = Buffer.from(`${twilio.accountSid}:${twilio.authToken}`).toString("base64");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authValue}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twilio HTTP ${response.status}: ${errorText.slice(0, 180)}`);
  }

  const payload = await response.json();
  return { sent: true, sid: payload.sid };
}

function normalizeBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || "").trim();
  if (configured) {
    const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    return withProtocol.replace(/\/+$/, "");
  }
  return `${req.protocol}://${req.get("host")}`;
}

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ext && ext.length <= 5 ? ext : ".jpg";
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${safeExt}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image uploads are allowed."));
    }
    cb(null, true);
  }
});

app.get("/", (req, res) => {
  const baseUrl = normalizeBaseUrl(req);
  const menuUrl = `${baseUrl}/menu`;
  const whatsappNumber = normalizeWhatsappNumber(process.env.WHATSAPP_NUMBER);
  const twilioEnabled = getTwilioConfig().enabled;
  res.render("home", {
    menuUrl,
    whatsappConfigured: Boolean(whatsappNumber) || twilioEnabled
  });
});

app.get(
  "/qr.png",
  asyncHandler(async (req, res) => {
    const baseUrl = normalizeBaseUrl(req);
    const menuUrl = `${baseUrl}/menu`;
    const png = await QRCode.toBuffer(menuUrl, {
      type: "png",
      width: 700,
      margin: 1
    });
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  })
);

app.get(
  "/menu",
  asyncHandler(async (req, res) => {
    const cocktails = await all("SELECT id, name, ingredients, image_path FROM cocktails ORDER BY name ASC");
    const whatsappNumber = normalizeWhatsappNumber(process.env.WHATSAPP_NUMBER);
    const twilioEnabled = getTwilioConfig().enabled;
    const selectedId = Number.parseInt(req.query.cocktail_id, 10) || null;
    res.render("menu", {
      cocktails,
      selectedId,
      orderError: req.query.order_error || null,
      orderSuccess: req.query.order_success || null,
      whatsappConfigured: Boolean(whatsappNumber) || twilioEnabled
    });
  })
);

app.post(
  "/order",
  asyncHandler(async (req, res) => {
    const customerName = (req.body.customer_name || "").trim();
    const note = (req.body.note || "").trim();
    const cocktailId = Number.parseInt(req.body.cocktail_id, 10);
    const whatsappNumber = normalizeWhatsappNumber(process.env.WHATSAPP_NUMBER);

    if (!customerName || Number.isNaN(cocktailId)) {
      return res.redirect(`/menu?order_error=Completeaza+numele+si+bautura&cocktail_id=${cocktailId || ""}`);
    }

    const cocktail = await get("SELECT id, name FROM cocktails WHERE id = ?", [cocktailId]);
    if (!cocktail) {
      return res.redirect("/menu?order_error=Bautura+aleasa+nu+exista");
    }

    const createdOrder = await run(
      `
      INSERT INTO orders (customer_name, cocktail_id, cocktail_name, note)
      VALUES (?, ?, ?, ?)
      `,
      [customerName, cocktail.id, cocktail.name, note || null]
    );

    const lines = [
      "Salut! Comanda noua de cocktail:",
      `Nume: ${customerName}`,
      `Bautura: ${cocktail.name}`,
      note ? `Detalii: ${note}` : null
    ].filter(Boolean);
    const messageBody = lines.join("\n");

    const twilio = getTwilioConfig();
    const whatsappUrl = whatsappNumber
      ? `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(messageBody)}`
      : "";

    if (twilio.enabled) {
      try {
        await sendTwilioWhatsappMessage(messageBody);
        return res.redirect(`/order/success?order_id=${createdOrder.id}`);
      } catch (err) {
        console.error("Twilio send failed:", err.message);
        if (whatsappUrl) {
          return res.redirect(
            `/order/success?order_id=${createdOrder.id}&whatsapp_url=${encodeURIComponent(whatsappUrl)}&fallback=1`
          );
        }
        return res.redirect("/menu?order_error=Comanda+salvata,+dar+trimiterea+automata+a+esuat");
      }
    }

    if (whatsappUrl) {
      return res.redirect(`/order/success?order_id=${createdOrder.id}&whatsapp_url=${encodeURIComponent(whatsappUrl)}`);
    }

    return res.redirect(`/order/success?order_id=${createdOrder.id}`);
  })
);

app.get(
  "/order/success",
  asyncHandler(async (req, res) => {
    const orderId = Number.parseInt(req.query.order_id, 10);
    if (Number.isNaN(orderId)) {
      return res.redirect("/menu");
    }

    const order = await get("SELECT id, customer_name, cocktail_name FROM orders WHERE id = ?", [orderId]);
    if (!order) {
      return res.redirect("/menu");
    }

    const whatsappUrl = (req.query.whatsapp_url || "").trim();
    const fallback = req.query.fallback === "1";

    return res.render("order-success", {
      order,
      whatsappUrl: whatsappUrl.startsWith("https://wa.me/") ? whatsappUrl : "",
      fallback
    });
  })
);

app.get(
  "/cocktail/:id",
  asyncHandler(async (req, res) => {
    const cocktail = await get("SELECT * FROM cocktails WHERE id = ?", [req.params.id]);
    if (!cocktail) {
      return res.status(404).render("not-found");
    }
    return res.render("cocktail", { cocktail });
  })
);

app.get("/admin/login", (req, res) => {
  if (req.session.isAdmin) {
    return res.redirect("/admin");
  }
  return res.render("admin-login", { error: null });
});

app.post("/admin/login", (req, res) => {
  const password = req.body.password || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "change-me";

  if (password !== adminPassword) {
    return res.status(401).render("admin-login", { error: "Parola incorecta." });
  }

  req.session.isAdmin = true;
  return res.redirect("/admin");
});

app.post("/admin/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/admin/login");
  });
});

app.get(
  "/admin",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const cocktails = await all("SELECT id, name, ingredients, image_path, created_at FROM cocktails ORDER BY id DESC");
    const orders = await all(
      "SELECT id, customer_name, cocktail_name, note, created_at FROM orders ORDER BY id DESC LIMIT 100"
    );
    const editId = Number.parseInt(req.query.edit_id, 10);
    const editCocktail = Number.isNaN(editId)
      ? null
      : await get("SELECT id, name, ingredients, image_path FROM cocktails WHERE id = ?", [editId]);
    let error = req.query.error || null;
    if (!Number.isNaN(editId) && !editCocktail) {
      error = "Cocktail-ul selectat pentru editare nu exista.";
    }

    res.render("admin-dashboard", {
      cocktails,
      orders,
      editCocktail,
      error,
      success: req.query.success || null
    });
  })
);

app.post(
  "/admin/cocktails",
  requireAdmin,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const name = (req.body.name || "").trim();
    const ingredients = (req.body.ingredients || "").trim();
    const instructions = "N/A";

    if (!name || !ingredients) {
      if (req.file) {
        deleteImageByPath(`/uploads/${req.file.filename}`);
      }
      const cocktails = await all("SELECT id, name, ingredients, image_path, created_at FROM cocktails ORDER BY id DESC");
      const orders = await all(
        "SELECT id, customer_name, cocktail_name, note, created_at FROM orders ORDER BY id DESC LIMIT 100"
      );
      return res.status(400).render("admin-dashboard", {
        cocktails,
        orders,
        editCocktail: null,
        error: "Numele si ingredientele sunt obligatorii.",
        success: null
      });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    await run(
      `
      INSERT INTO cocktails (name, ingredients, instructions, image_path, strength, glass_type, garnish, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [name, ingredients, instructions, imagePath, null, null, null, null]
    );

    return res.redirect("/admin?success=Saved");
  })
);

app.post(
  "/admin/cocktails/:id/update",
  requireAdmin,
  upload.single("image"),
  asyncHandler(async (req, res) => {
    const cocktailId = Number.parseInt(req.params.id, 10);
    if (Number.isNaN(cocktailId)) {
      if (req.file) {
        deleteImageByPath(`/uploads/${req.file.filename}`);
      }
      return res.redirect("/admin?error=ID+cocktail+invalid");
    }

    const existingCocktail = await get("SELECT id, name, ingredients, image_path FROM cocktails WHERE id = ?", [cocktailId]);
    if (!existingCocktail) {
      if (req.file) {
        deleteImageByPath(`/uploads/${req.file.filename}`);
      }
      return res.redirect("/admin?error=Cocktail+inexistent");
    }

    const name = (req.body.name || "").trim();
    const ingredients = (req.body.ingredients || "").trim();

    if (!name || !ingredients) {
      if (req.file) {
        deleteImageByPath(`/uploads/${req.file.filename}`);
      }
      const cocktails = await all("SELECT id, name, ingredients, image_path, created_at FROM cocktails ORDER BY id DESC");
      const orders = await all(
        "SELECT id, customer_name, cocktail_name, note, created_at FROM orders ORDER BY id DESC LIMIT 100"
      );
      return res.status(400).render("admin-dashboard", {
        cocktails,
        orders,
        editCocktail: {
          ...existingCocktail,
          name: name || existingCocktail.name,
          ingredients: ingredients || existingCocktail.ingredients
        },
        error: "Numele si ingredientele sunt obligatorii.",
        success: null
      });
    }

    let imagePath = existingCocktail.image_path;
    if (req.file) {
      imagePath = `/uploads/${req.file.filename}`;
      deleteImageByPath(existingCocktail.image_path);
    }

    await run("UPDATE cocktails SET name = ?, ingredients = ?, image_path = ? WHERE id = ?", [
      name,
      ingredients,
      imagePath,
      cocktailId
    ]);

    return res.redirect("/admin?success=Cocktail+actualizat");
  })
);

app.post(
  "/admin/orders/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    await run("DELETE FROM orders WHERE id = ?", [req.params.id]);
    return res.redirect("/admin?success=Order+deleted");
  })
);

app.post(
  "/admin/cocktails/:id/delete",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const row = await get("SELECT image_path FROM cocktails WHERE id = ?", [req.params.id]);
    if (row && row.image_path) deleteImageByPath(row.image_path);

    await run("DELETE FROM cocktails WHERE id = ?", [req.params.id]);
    await run("DELETE FROM orders WHERE cocktail_id = ?", [req.params.id]);
    return res.redirect("/admin?success=Deleted");
  })
);

app.use((req, res) => {
  res.status(404).render("not-found");
});

app.use((err, req, res, next) => {
  const message = err && err.message ? err.message : "Internal server error";
  if (req.path.startsWith("/admin")) {
    return res.status(500).render("admin-login", { error: message });
  }
  return res.status(500).send(message);
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
