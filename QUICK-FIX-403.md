# ⚡ Quick Fix: 403 Error

## 🎯 TL;DR

Your **Honeywell T6 Pro** works with **Google Home** but is **NOT registered** with the **Google Smart Device Management API**.

## 🚀 3-Step Fix

### Step 1: Go to Device Access Console
👉 **[Click Here](https://console.nest.google.com/device-access/project-list)**

### Step 2: Check Your Devices
- Look for project: `cfeba254-56f3-4dbb-9aaf-1a5837737c2d`
- See if your **T6 Pro** is listed
- You should see your 3 Nest thermostats ✅
- Is your T6 Pro missing? ❌

### Step 3: Link Your T6 Pro
If T6 Pro is missing:
1. Click "Add Device" or "Link Device"
2. Follow the authorization flow
3. Grant SDM API permissions
4. Wait for device to appear in list

### Step 4: Refresh Your App
1. Go to `http://localhost:3000`
2. **Sign Out**
3. **Sign In** again
4. Your T6 Pro should now appear! 🎉

---

## 🤔 Why This Happens

```
Google Home API ≠ Google SDM API
       ↓                ↓
  Consumer Use    Developer Use
```

Your T6 Pro needs **explicit registration** in the SDM project.

---

## 📹 Visual Check

When you open Device Access Console, you should see:

```
✅ Nest Thermostat 1
✅ Nest Thermostat 2  
✅ Nest Thermostat 3
❌ Honeywell T6 Pro  <-- Should be here!
```

---

## 🆘 Still Having Issues?

### Check the detailed error message:
```bash
# Watch server logs
tail -f server-log.txt
```

### Try refreshing your token:
1. Clear browser cache: `Cmd+Shift+Delete` (Mac) or `Ctrl+Shift+Delete` (Windows)
2. Sign out and sign in again

### Verify API is enabled:
👉 [Google Cloud Console](https://console.cloud.google.com/apis/api/smartdevicemanagement.googleapis.com)

---

## 📚 More Details

See `TROUBLESHOOTING-403.md` for complete troubleshooting guide.

---

**Expected Result After Fix:**
- All 3 Nest thermostats visible ✅
- Honeywell T6 Pro visible ✅
- No more 403 errors ✅

