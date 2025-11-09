bagaimana cara kerjanya??

setelah menginstal dependency 
snapsave-media-downloader

tahap kesatu 
saya melakukan request ke snapsave-media-downloader pada file server.js
setelah URL downloader berhasil di dapatkan, saya melanjutkan nya ke tahap kedua 
yaitu melakukan request ke sebuah website pribadi dengan URL endPoint 

https://shtl.pw/getmylink/get.php?send=${send}&source=${source}

pada request tersebut terjadi beberapa tahapan proses di latar belakang 

1. URL media di upload ke server telegram menggunakan Bot khusus ( reguler bot)
2. setelah berhasil status (ok 200) website juga menjalankan progres Shortlink URL secara bersamaan 
sehingga URL yang anda dapatkan akan terlihat seperti https://shtl.pw/gml_xxxxxx contoh: https://shtl.pw/gml_yznT94sQ



