import { put, head } from '@vercel/blob';

export default async function handler(req, res) {
  // Log 1: Cek setiap request yang masuk
  console.log(`[Request] Method: ${req.method} | Time: ${new Date().toISOString()}`);

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Gunakan POST untuk mencatat kunjungan.' });
  }

  // Log 2: Deteksi IP
  const forwarded = req.headers['x-forwarded-for'];
  const visitorIP = typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress;
  console.log(`[Visitor] IP Terdeteksi: ${visitorIP}`);

  const fileName = 'data/visitors.json';

  try {
    let data = { count: 0, ips: [] };

    // 1. Cek keberadaan file di Blob
    try {
      console.log(`[Blob] Mencoba mengecek file: ${fileName}`);
      const fileInfo = await head(fileName);
      
      if (fileInfo) {
        console.log(`[Blob] File ditemukan. URL: ${fileInfo.url}`);
        
        // Fetch data JSON
        const response = await fetch(fileInfo.url);
        if (!response.ok) throw new Error(`Gagal fetch file: ${response.statusText}`);
        
        data = await response.json();
        console.log(`[Data] Current Count: ${data.count} | IP Terdaftar: ${data.ips.length}`);
      }
    } catch (e) {
      // Log 3: Info jika file belum ada
      console.warn(`[Info] File ${fileName} belum ada atau tidak bisa diakses. Menggunakan data default.`);
    }

    // 2. Logika IP Unik
    if (!data.ips.includes(visitorIP)) {
      data.count += 1;
      data.ips.push(visitorIP);
      console.log(`[Update] IP Baru ditemukan. Count naik menjadi: ${data.count}`);

      // 3. Simpan kembali ke Vercel Blob
      try {
        const uploadResult = await put(fileName, JSON.stringify(data), {
          access: 'public',
          addRandomSuffix: false,
          contentType: 'application/json',
          token: process.env.BLOB_READ_WRITE_TOKEN || process.env.MediaGraph99_READ_WRITE_TOKEN
        });
        console.log(`[Success] Data berhasil disimpan. URL: ${uploadResult.url}`);
      } catch (uploadErr) {
        console.error(`[Critical] Gagal Upload ke Blob: ${uploadErr.message}`);
        throw uploadErr; // Lempar ke catch utama
      }
    } else {
      console.log(`[Skip] IP sudah terdaftar. Tidak menambah hitungan.`);
    }

    // 4. Respon sukses
    return res.status(200).json({ 
      success: true, 
      count: data.count 
    });

  } catch (error) {
    // Log 4: Error fatal
    console.error(`[Error Utama]: ${error.message}`);
    console.error(`[Stack]: ${error.stack}`);
    
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      tip: "Cek Vercel Logs untuk detail error lebih lanjut."
    });
  }
}
