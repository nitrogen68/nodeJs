import { put, head } from '@vercel/blob';

export default async function handler(req, res) {
  // Hanya izinkan POST (Sesuai keinginan Anda)
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Gunakan POST untuk mencatat kunjungan.' });
  }

  // Mendapatkan IP Visitor dari Header Vercel
  const forwarded = req.headers['x-forwarded-for'];
  const visitorIP = typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket.remoteAddress;

  const fileName = 'data/visitors.json';

  try {
    let data = { count: 0, ips: [] };

    // 1. Cek apakah file data sudah ada di Blob
    try {
      const fileInfo = await head(fileName);
      if (fileInfo) {
        const response = await fetch(fileInfo.url);
        data = await response.json();
      }
    } catch (e) {
      // Jika file belum ada (error 404), biarkan data tetap default {count: 0, ips: []}
      console.log("File baru akan dibuat.");
    }

    // 2. Logika IP Unik: Jika IP belum ada di daftar, tambah +1
    if (!data.ips.includes(visitorIP)) {
      data.count += 1;
      data.ips.push(visitorIP); // Simpan IP agar tidak dihitung dua kali

      // 3. Simpan kembali ke Vercel Blob (Overwriting file lama)
      await put(fileName, JSON.stringify(data), {
        access: 'public',
        addRandomSuffix: false, // PENTING: Agar nama file tetap visitors.json (tidak berubah-ubah)
        contentType: 'application/json',
        token: process.env.BLOB_READ_WRITE_TOKEN 
      });
    }

    // 4. Kirim hasil count ke Frontend
    return res.status(200).json({ 
      success: true, 
      count: data.count 
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
