Railway:
1) ارفع الملفات على GitHub (بدون .env و node_modules)
2) Railway > New Project > Deploy from GitHub repo
3) Variables: اضف DISCORD_TOKEN و GEMINI_API_KEY و GEMINI_MODEL
4) Volume: من الخدمة اضغط Add Volume وخلي Mount Path = /data
   (بدونه الروم المحفوظة تنمسح مع كل نشر جديد)
5) ما يحتاج Domain ولا Port، البوت يشتغل بالخلفية
