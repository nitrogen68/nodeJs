## ⚙️ **How ​​Does It Work?**

After installing the **`snapsave-media-downloader`** dependency, the system process occurs in **two main stages**:

### 🧩 **First Stage**

I make a request to **`snapsave-media-downloader`** in the **`server.js`** file.
After the **downloader URL** is successfully obtained, the process continues to the second stage.

### 🔗 **Second Stage**

This stage makes a request to a personal website with the following endpoint:

https://shtl.pw/getmylink/get.php?send=${send}&source=${source}

In this request, several processes run in the background:

1. **The media URL is uploaded to the Telegram server** using a special bot (**a regular bot**).

 2. After the **(OK 200)** status is received, the website also runs the **Shortlink URL** process simultaneously.

As a result, the URL you receive will look like:

https://shtl.pw/gml_xxxxxx

**Real example:**

https://shtl.pw/gml_yznT94sQ

### 📦 **What Do You Get?**

The shortlink page provides:
- **A permanent file** that can be downloaded at any time.
- **A short link** that is easy to share.
- As long as the website is active, the file will remain available and safe to access.

### 📍 **Need to Know**

> On the regular Telegram Bot, the maximum file size that can be uploaded is 20 MB.
> So, you can still get the downloaded video, but the **Shortlink fetching** process will fail if the file exceeds this limit.
