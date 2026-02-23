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

function normalizeWhatsappNumber(value) {
  return String(value || "").replace(/[^\d]/g, "");
}

function normalizeBaseUrl(req) {
  const configured = (process.env.PUBLIC_BASE_URL || "").trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
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
  res.render("home", {
    menuUrl,
    adminUrl: `${baseUrl}/admin/login`,
    whatsappConfigured: Boolean(whatsappNumber)
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
    const selectedId = Number.parseInt(req.query.cocktail_id, 10) || null;
    res.render("menu", {
      cocktails,
      selectedId,
      orderError: req.query.order_error || null,
      orderSuccess: req.query.order_success || null,
      whatsappConfigured: Boolean(whatsappNumber)
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
      return res.redirect("/menu?order_error=Complete+name+and+drink");
    }

    const cocktail = await get("SELECT id, name FROM cocktails WHERE id = ?", [cocktailId]);
    if (!cocktail) {
      return res.redirect("/menu?order_error=Invalid+drink+selected");
    }

    await run(
      `
      INSERT INTO orders (customer_name, cocktail_id, cocktail_name, note)
      VALUES (?, ?, ?, ?)
      `,
      [customerName, cocktail.id, cocktail.name, note || null]
    );

    if (!whatsappNumber) {
      return res.redirect("/menu?order_success=Order+saved.+Set+WHATSAPP_NUMBER+to+send+on+WhatsApp.");
    }

    const lines = [
      "Salut! Comanda noua de cocktail:",
      `Nume: ${customerName}`,
      `Bautura: ${cocktail.name}`,
      note ? `Detalii: ${note}` : null
    ].filter(Boolean);
    const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
    return res.redirect(whatsappUrl);
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
    return res.status(401).render("admin-login", { error: "Wrong password." });
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
    const cocktails = await all("SELECT id, name, image_path, created_at FROM cocktails ORDER BY id DESC");
    const orders = await all(
      "SELECT id, customer_name, cocktail_name, note, created_at FROM orders ORDER BY id DESC LIMIT 100"
    );
    res.render("admin-dashboard", {
      cocktails,
      orders,
      error: null,
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
    const instructions = (req.body.instructions || "").trim();
    const strength = (req.body.strength || "").trim();
    const glassType = (req.body.glass_type || "").trim();
    const garnish = (req.body.garnish || "").trim();
    const tags = (req.body.tags || "").trim();

    if (!name || !ingredients || !instructions) {
      const cocktails = await all("SELECT id, name, image_path, created_at FROM cocktails ORDER BY id DESC");
      const orders = await all(
        "SELECT id, customer_name, cocktail_name, note, created_at FROM orders ORDER BY id DESC LIMIT 100"
      );
      return res.status(400).render("admin-dashboard", {
        cocktails,
        orders,
        error: "Name, ingredients and preparation are required.",
        success: null
      });
    }

    const imagePath = req.file ? `/uploads/${req.file.filename}` : null;

    await run(
      `
      INSERT INTO cocktails (name, ingredients, instructions, image_path, strength, glass_type, garnish, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [name, ingredients, instructions, imagePath, strength, glassType, garnish, tags]
    );

    return res.redirect("/admin?success=Saved");
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
    if (row && row.image_path) {
      const fileName = path.basename(row.image_path);
      const targetPath = path.join(uploadDir, fileName);
      if (targetPath.startsWith(uploadDir) && fs.existsSync(targetPath)) {
        fs.unlinkSync(targetPath);
      }
    }

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
