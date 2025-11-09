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
// 📥 API DOWNLOAD MENGGUNAKAN SNAPSAVE (DIKEMBALIKAN)
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

    // Mengembalikan data mentah SnapSave
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
// 🌐 PROXY UNTUK GET.PHP (DIKEMBALIKAN)
// ======================================================
app.get("/proxy/get.php", async (req, res) => {
  const { send, source } = req.query;
  if (!send) {
    return res.status(400).json({ status: "error", message: "Missing 'send' parameter." });
  }

  const targetUrl = `https://shtl.pw/getmylink/get.php?send=${send}&source=${source || ""}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000); // 15 detik timeout
    const response = await fetch(targetUrl, { signal: controller.signal });
    clearTimeout(timeout);
    
    // Pastikan response berhasil sebelum membaca JSON
    if (!response.ok) {
        throw new Error(`shtl.pw merespons status ${response.status}`);
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({
      status: "error",
      message: `Failed to connect to get.php or receive valid response: ${error.message}`,
    });
  }
});


// ======================================================
// 🆕 ENDPOINT UTAMA: /apiDl (INTEGRASI PENUH SHORTLINK)
// ======================================================

const handleApiDl = async (req, res) => {
  const originalUrl = req.body.url || req.query.url;

  if (!originalUrl) {
    return res.status(400).json({
      status: "error",
      failure_stage: "INPUT_VALIDATION",
      message: "Parameter 'url' wajib diisi (URL media sosial).",
    });
  }

  try {
    console.log(`📥 [API DL] Menganalisis URL: ${originalUrl}`);

    // --- TAHAP 1: DAPATKAN LINK DARI SNAPSAVE ---
    let snapsaveResult;
    try {
        // Panggil SnapSave.
        snapsaveResult = await snapsave(originalUrl);
    } catch (snapsaveError) {
        // Tangkap kegagalan spesifik dari SnapSave
        console.error("❌ [API DL] SnapSave Error:", snapsaveError.message);
        return res.status(500).json({
            status: "error",
            failure_stage: "SNAP_SAVE_ANALYSIS_FAILED",
            message: `Gagal menganalisis URL media: ${snapsaveError.message}. SnapSave mungkin sedang offline atau URL sangat kompleks.`,
            "Original URL": originalUrl,
        });
    }


    const data = snapsaveResult?.data;

    // Pengecekan dasar: pastikan data dan media array ada
    if (!data || !Array.isArray(data.media) || data.media.length === 0) {
      return res.status(404).json({
          status: "error",
          failure_stage: "SNAP_SAVE_NO_MEDIA_FOUND",
          message: "Media tidak ditemukan atau URL tidak valid oleh SnapSave (Mungkin private atau tidak ada video/foto).",
          "Original URL": originalUrl,
      });
    }

    // CARI MEDIA PERTAMA DENGAN URL YANG VALID
    // Baris ini adalah perbaikan agar tidak terjadi TypeError: Cannot read properties of undefined (reading 'url')
    const bestMedia = data.media.find(
      (m) => m && typeof m.url === 'string' && m.url.startsWith("http")
    );

    const downloadLink = bestMedia?.url; 
    
    // Pastikan download link ditemukan
    if (!downloadLink) {
      return res.status(400).json({
          status: "error",
          failure_stage: "SNAP_SAVE_INVALID_DOWNLOAD_LINK",
          message: "SnapSave berhasil dianalisis, tetapi tidak menghasilkan tautan download yang valid atau dapat digunakan.",
          "Original URL": originalUrl,
      });
    }

    console.log("🔗 SnapSave Link Terbaik Ditemukan, Meneruskan ke shtl.pw...");

    // --- TAHAP 2: PROSES KE SHORLINK/TELEGRAM MELALUI SHTL.PW ---

    // Gunakan downloadLink sebagai parameter 'send'
    const shtlPwEndpoint = `https://shtl.pw/getmylink/get.php?send=${encodeURIComponent(downloadLink)}&source=snapsave`;

    // Beri timeout yang lebih lama karena ada proses upload Telegram di shtl.pw
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60 detik timeout

    const shtlPwResponse = await fetch(shtlPwEndpoint, {
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!shtlPwResponse.ok) {
        // Jika shtl.pw mengembalikan status HTTP error (4xx, 5xx)
        throw new Error(`shtl.pw merespons status HTTP ${shtlPwResponse.status}`);
    }

    const shtlPwData = await shtlPwResponse.json();

    // Cek respons dari shtl.pw untuk shortlink
    if (shtlPwData.status !== "success" || !shtlPwData.url) {
      const shtlErrorMessage = shtlPwData.message || "shtl.pw gagal menghasilkan shortlink.";
      return res.status(500).json({
        status: "error",
        failure_stage: "SHORTLINK_API_STATUS_FAILED",
        message: `Gagal Shortlink: ${shtlErrorMessage}`,
        "Original URL": originalUrl,
      });
    }

    // --- TAHAP 3: RESPON FINAL SESUAI PERMINTAAN ---
    res.json({
      status: "success",
      url: shtlPwData.url, // Shortlink URL yang didapatkan
      failure_stage: "SUCCESS",
      "Original URL": originalUrl,
    });

  } catch (err) {
    // Tangkap error umum (Timeout pada fetch shtl.pw atau kesalahan kritis tak terduga)
    const failureStage = err.message.includes("shtl.pw") || err.name === "AbortError" 
        ? "SHORTLINK_CONNECTION_FAILED" 
        : "UNEXPECTED_SERVER_ERROR";
    
    console.error(`❌ [API DL] Error dalam proses Shortlink (Stage: ${failureStage}):`, err.message);
    res.status(500).json({
      status: "error",
      failure_stage: failureStage,
      message: `Terjadi kegagalan server: ${err.message}. Periksa status API pihak ketiga atau coba lagi.`,
      "Original URL": originalUrl,
    });
  }
};

// Daftarkan handler untuk GET dan POST
app.post("/apiDl", handleApiDl);
app.get("/apiDl", handleApiDl);

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
