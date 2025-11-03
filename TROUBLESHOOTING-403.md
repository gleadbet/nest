# 🚨 Troubleshooting 403 Forbidden Error - Google Smart Device Management API

## 📋 Error Summary

You're receiving a **403 Forbidden** error when trying to access devices via the Google Smart Device Management (SDM) API. This is happening even though:
- ✅ Your Honeywell T6 Pro works with the **Resideo app**
- ✅ Your Honeywell T6 Pro works with **Google Home**
- ✅ You have 3 Nest thermostats working via SDM API
- ❌ Your T6 Pro is **NOT showing up** in the SDM API

## 🔍 Root Cause

**Google Home ≠ Google Smart Device Management API**

Your T6 Pro is connected to **Google Home's consumer API**, which is completely separate from the **Smart Device Management (SDM) API** that this application uses.

```
┌─────────────────────────────────────────────────────────┐
│                    Your Current Setup                   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Nest Thermostats (3 devices)                          │
│    ↓                                                    │
│  Google SDM API ✅                                      │
│    ↓                                                    │
│  Your Application ✅                                    │
│                                                         │
│  Honeywell T6 Pro                                      │
│    ↓                                                    │
│  Google Home API ✅                                     │
│    ↓                                                    │
│  Your Application ❌ (403 Forbidden)                   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

## 💡 Why This Happens

1. **Google Home** uses a consumer-grade API for basic smart home control
2. **Google SDM API** requires explicit device registration in the Device Access Console
3. **Works with Google Home** does NOT automatically mean "works with SDM API"
4. Your T6 Pro needs to be **explicitly added** to your SDM project

## ✅ Solution Options

### Option 1: Add T6 Pro to Google Device Access Console (Recommended)

**Step 1: Check Current Devices**
1. Go to [Google Device Access Console](https://console.nest.google.com/device-access/project-list)
2. Sign in with your Google account
3. Select your project: `cfeba254-56f3-4dbb-9aaf-1a5837737c2d`
4. Look at the list of authorized devices
5. Check if your T6 Pro is listed

**Step 2: Add Device to SDM Project**
If your T6 Pro is NOT listed:
1. In Device Access Console, click "Add Device" or "Link Device"
2. Follow the OAuth flow to authorize your T6 Pro
3. Grant permissions for the SDM API scope
4. Verify the device appears in the device list

**Step 3: Verify in Your App**
1. Sign out of your thermostat control app
2. Sign in again (to get fresh OAuth token with new device)
3. The T6 Pro should now appear alongside your Nest thermostats

---

### Option 2: Enable Local API on T6 Pro (Alternative)

If you can't add the T6 Pro to SDM, we already built local API support:

**Check if your T6 Pro has local API:**
1. Access your T6 Pro's settings menu
2. Look for "Network Settings" or "Advanced Settings"
3. Check for "Local API", "HTTP Interface", or "Developer Mode"

**If available:**
1. Enable the local HTTP API
2. Set a username and password
3. Use the Honeywell device manager in your app to add it
4. Go to: `http://localhost:3000/honeywell`

**Note:** Most T6 Pro units do NOT have a local HTTP API by default

---

### Option 3: Use Simulated Device (For Testing)

We've implemented simulated device support for testing:

```bash
# Add a simulated T6 Pro
curl -X POST http://localhost:3000/api/devices/honeywell \
  -H "Content-Type: application/json" \
  -d '{
    "action": "addSimulated",
    "ip": "192.168.1.244",
    "name": "Simulated T6 Pro"
  }'
```

---

## 🔧 Additional Checks

### Check 1: Verify OAuth Token
Your access token may be expired:
1. Open your app: `http://localhost:3000`
2. Click "Sign Out"
3. Click "Sign In with Google"
4. Grant all permissions
5. Try again

### Check 2: Verify Google Cloud Project Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to "APIs & Services" → "Enabled APIs & services"
4. Verify "Smart Device Management API" is **enabled**
5. If not, click "Enable" and try again

### Check 3: Check OAuth Consent Screen
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to "APIs & Services" → "OAuth consent screen"
3. Verify status is "Published" or "In Production"
4. If "Testing" - add your email to test users
5. Verify scope includes: `https://www.googleapis.com/auth/sdm.service`

### Check 4: Monitor Server Logs
When you load `http://localhost:3000`, the server will now log detailed 403 error information:

```bash
tail -f server-log.txt
```

Look for:
```
🚫 403 FORBIDDEN - Google SDM API Error:
  Error Message: [specific error message]
  Error Details: [detailed error information]
```

---

## 📊 What the 403 Error Tells Us

| Error Message | Meaning | Solution |
|--------------|---------|----------|
| "Insufficient authentication scopes" | OAuth token doesn't have SDM permission | Re-authenticate with correct scope |
| "Project does not have access to this device" | Device not in your SDM project | Add device to Device Access Console |
| "Permission denied" | General permission issue | Check API is enabled in GCP |
| "Invalid authentication credentials" | Token expired or invalid | Sign out and sign in again |
| "The caller does not have permission" | Device not linked to project | Register device in Device Access Console |

---

## 🎯 Most Likely Cause for Your Situation

Based on your description:
- ✅ 3 Nest thermostats working fine
- ❌ T6 Pro not appearing
- ✅ T6 Pro works with Google Home

**Diagnosis:** Your T6 Pro is connected to Google Home but **NOT registered** in your Google Device Access (SDM) project.

**Fix:** Follow **Option 1** above to add the T6 Pro to your Device Access Console project.

---

## 🆘 Need More Help?

1. **Check server logs** for detailed error message
2. **Try signing out and in** to refresh token
3. **Verify Device Access Console** shows your T6 Pro
4. **Check Google Cloud Console** for API status

---

## 📝 Current Configuration

- **Google Project ID:** `cfeba254-56f3-4dbb-9aaf-1a5837737c2d`
- **OAuth Client ID:** `927519702946-87nv6joncgimj9u4m5icalhc3cn83jue.apps.googleusercontent.com`
- **OAuth Scope:** `https://www.googleapis.com/auth/sdm.service`
- **Device Access Console:** https://console.nest.google.com/device-access/project-list
- **Google Cloud Console:** https://console.cloud.google.com/

---

## 🔗 Useful Links

- [Google Device Access Console](https://console.nest.google.com/device-access/)
- [Google Cloud Console](https://console.cloud.google.com/)
- [SDM API Documentation](https://developers.google.com/nest/device-access)
- [OAuth Troubleshooting](https://developers.google.com/identity/protocols/oauth2/web-server#error-codes)

---

**Last Updated:** Now

**Next Steps:**
1. Go to Device Access Console
2. Check if T6 Pro is listed
3. If not, link it to your project
4. Sign out and back in to your app
5. T6 Pro should appear!

