## ⚙️ **How Does It Work?**

After installing the **`snapsave-media-downloader`** dependency, the system operates in **two main stages**.



### 🧩 **First Stage**

A request is made to **`snapsave-media-downloader`** inside the **`server.js`** file.  
Once the **downloader URL** is successfully retrieved, the process continues to the **second stage**.


### 🔗 **Second Stage**

At this stage, a request is sent to a personal API endpoint:

https://shtl.pw/getmylink/get.php?send=${send}&source=${source}



### 📥 **Example Success Response**


{
  "status": "success",
  "url": "$short_link"
}




⚠️ Example Error Response

{
  "status": "error",
  "error": {
    "message": "Failed to send video to Telegram: Unknown error"
  }
}




🧠 Parameter Explanation

Parameter	Description

$send	The media URL extracted from SnapDL.
$source	The original source URL before the extraction process begins.





⚙️ Background Process

When the above request is made, several operations occur automatically in the background:

1. The media URL is uploaded to the Telegram server using a special bot (regular bot).


2. Once the server returns a status (OK 200), the system simultaneously runs a shortlink generator.



As a result, you’ll receive a shortened URL that looks like this:

https://shtl.pw/gml_xxxxxx

Example:

https://shtl.pw/gml_yznT94sQ




📦 What Do You Get?

The generated shortlink page provides:

✅ Permanent file access — downloadable anytime.

🔗 Shareable short URL — easy to copy and distribute.

💾 Persistent availability — files remain accessible as long as the website stays active.




📍 Important Note

> ⚠️ On the regular Telegram Bot, the maximum upload file size is 20 MB.
You can still download the video, but the shortlink generation process will fail if the file exceeds this limit.
