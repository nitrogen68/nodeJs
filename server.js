// ======================================================
// 📦 IMPORT MODULE SERVER.JS
// ======================================================
import fs from "fs";
import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { snapsave } from "snapsave-media-downloader";
import { spawn, exec } from "child_process";
import os from "os";

// ======================================================
// ⚙️ SETUP DASAR
// ======================================================
const app = express();
app.use(express.json());

// Header CORS global
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ======================================================
// 📁 PATH & KONSTANTA
// ======================================================
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = process.cwd();
const projectPath = path.join(os.homedir(), "storage", "downloads", "node_projects");
const PORT = process.env.PORT || 3000;

// ======================================================
// 🌐 Sajikan file statis dari ROOT (karena index.html di root)
// ======================================================
app.use(express.static(__dirname));

// Rute utama untuk "/"
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ======================================================
// 🧹 AUTO CLEANER UNTUK FILE .d.ts
// ======================================================
function deleteDTS(filePath) {
  if (!filePath.endsWith(".d.ts")) return;
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log("🗑️ Hapus otomatis:", filePath);
    }
  } catch (err) {
    console.warn("⚠️ Gagal hapus:", filePath, "-", err.message);
  }
}

function deleteAllDTS(dir) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) deleteAllDTS(fullPath);
    else deleteDTS(fullPath);
  });
}

const nodeModulesPath = path.join(projectRoot, "node_modules");
if (fs.existsSync(nodeModulesPath)) {
  console.log("🧹 Menghapus semua file .d.ts di node_modules...");
  deleteAllDTS(nodeModulesPath);
}

// ======================================================
// 🧰 API UNTUK JALANKAN COMMAND TERMUX (opsional)
// ======================================================
const logFile = path.join(projectRoot, "command.log");
function logToFile(message) {
  try {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${message}\n`);
  } catch (err) {
    console.error("⚠️ Gagal menulis log:", err.message);
  }
}

app.post("/api/command", (req, res) => {
  const { cmd } = req.body;

  if (!cmd || typeof cmd !== "string") {
    return res.status(400).json({ success: false, error: "Perintah tidak valid." });
  }

  const allowed = ["npm", "cd", "ls", "pwd", "bash", "node"];
  if (!allowed.some((prefix) => cmd.trim().startsWith(prefix))) {
    return res.status(403).json({ success: false, error: "Perintah tidak diizinkan." });
  }

  console.log(`🟡 Menjalankan perintah: ${cmd} di folder ${projectPath}`);
  logToFile(`🟡 Menjalankan perintah: ${cmd}`);

  const parts = cmd.split(" ");
  const mainCmd = parts.shift();

  const child = spawn(mainCmd, parts, { cwd: projectPath });

  let output = "";
  let errorOutput = "";

  child.stdout.on("data", (data) => {
    output += data.toString();
  });

  child.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  child.on("close", (code) => {
    logToFile(`✅ Selesai (${cmd}) -> code: ${code}`);
    res.json({
      success: code === 0,
      output: output || "Tidak ada output.",
      error: errorOutput,
    });
  });

  child.on("error", (err) => {
    logToFile(`❌ Gagal menjalankan: ${cmd} -> ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  });
});




// ======================================================
// 🆕 ENDPOINT BARU: /apiDl (HANYA SNAPSAVE)
// ======================================================
app.post("/apiDl", async (req, res) => {
  try {
    // URL bisa dikirim melalui body (POST) atau query (GET), 
    // tapi POST lebih baik untuk URL panjang.
    const url = req.body.url || req.query.url; 
    
    if (!url) {
        return res.status(400).json({ 
            success: false, 
            error: "Parameter 'url' wajib diisi (URL media sosial)." 
        });
    }

    console.log(`📥 [API DL] Permintaan SnapSave diterima untuk URL: ${url}`);
    
    // Panggil library snapsave
    const result = await snapsave(url);
    const data = result?.data;

    if (!data?.media?.length) {
      return res.status(404).json({ success: false, error: "Tidak ada media ditemukan oleh SnapSave." });
    }

    const validMedia = data.media.filter(
      (m) =>
        m.url &&
        m.url.startsWith("http") &&
        !m.url.includes("undefined") &&
        !m.url.includes("null")
    );

    if (validMedia.length === 0) {
      return res.status(400).json({ success: false, error: "Media yang dikembalikan SnapSave tidak valid atau tidak bisa diputar." });
    }

    // Mengembalikan data mentah yang mudah diproses oleh klien pihak ketiga
    res.json({
      success: true,
      data: {
        description: data.description || "",
        preview: data.preview || "",
        media: validMedia.map((m) => ({
          resolution: m.resolution || "Unknown",
          url: m.url, // Link download langsung
          type: m.type || "unknown",
        })),
      },
    });

  } catch (err) {
    console.error("❌ [API DL] Error SnapSave:", err.message);
    res.status(500).json({ 
        success: false, 
        error: `Gagal memproses URL media: ${err.message}` 
    });
  }
});


// ======================================================
// 📥 API DOWNLOAD MENGGUNAKAN SNAPSAVE
// ======================================================
app.post("/api/download", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: "URL tidak boleh kosong" });

    console.log("📥 Permintaan download diterima untuk URL:", url);
    const result = await snapsave(url);
    const data = result?.data;

    if (!data?.media?.length) {
      return res.status(404).json({ success: false, error: "Tidak ada media ditemukan." });
    }

    const validMedia = data.media.filter(
      (m) =>
        m.url &&
        m.url.startsWith("http") &&
        !m.url.includes("undefined") &&
        !m.url.includes("null")
    );

    if (validMedia.length === 0) {
      return res.status(400).json({ success: false, error: "Media tidak valid atau URL tidak bisa diputar." });
    }

    res.json({
      success: true,
      data: {
        description: data.description || "",
        preview: data.preview || "",
        media: validMedia.map((m) => ({
          resolution: m.resolution || "Unknown",
          url: m.url,
          type: m.type || "unknown",
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ======================================================
// 🌐 PROXY UNTUK GET.PHP
// ======================================================
app.get("/proxy/get.php", async (req, res) => {
  const { send, source } = req.query;
  if (!send) {
    return res.status(400).json({ status: "error", message: "Missing 'send' parameter." });
  }

  const targetUrl = `https://shtl.pw/getmylink/get.php?send=${send}&source=${source || ""}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to connect to get.php: ${error.message}`,
    });
  }
});

// ======================================================
// 🚀 Jalankan server
// ======================================================
app.listen(PORT, () => {
  console.log(`✅ Server aktif di http://localhost:${PORT}`);
  console.log(`📂 Folder kerja: ${projectPath}`);

  if (os.platform() === "android") {
    setTimeout(() => {
      exec("termux-open-url http://localhost:3000/", (err) => {
        if (err) console.error("⚠️ Gagal membuka browser otomatis:", err.message);
        else console.log("🌐 Browser dibuka otomatis di http://localhost:3000/");
      });
    }, 3000);
  }
});
