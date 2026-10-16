/* FQ MMA public Supabase client bootstrap.
   Externalized to work with a strict script-src policy; never put service-role keys here. */
(function () {
  "use strict";

  window.SUPABASE_URL = "https://dmcbbavsxyxrxuuzraiu.supabase.co";
  window.SUPABASE_ANON_KEY = "sb_publishable_vJAptJ41TpicuxtMspB8tA_AaMFlGEC";
  window.supabaseReady = false;
  window.sb = null;
  window.supabaseInitPromise = null;

  function loadLibrary(src) {
    return new Promise(function (resolve, reject) {
      var script = document.createElement("script");
      var timeout = window.setTimeout(function () {
        script.remove();
        reject(new Error("Timed out loading Supabase library from " + src));
      }, 15000);
      script.src = src;
      script.async = true;
      script.onload = function () {
        window.clearTimeout(timeout);
        if (window.supabase && typeof window.supabase.createClient === "function") {
          resolve();
        } else {
          script.remove();
          reject(new Error("Supabase library loaded but did not expose window.supabase.createClient."));
        }
      };
      script.onerror = function () {
        window.clearTimeout(timeout);
        script.remove();
        reject(new Error("Could not load Supabase library from " + src));
      };
      document.head.appendChild(script);
    });
  }

  window.ensureSupabaseClient = async function () {
    if (window.sb && window.supabaseReady) return window.sb;
    if (window.supabaseInitPromise) return window.supabaseInitPromise;

    window.supabaseInitPromise = (async function () {
      if (!window.SUPABASE_URL || !window.SUPABASE_URL.startsWith("https://") ||
          !window.SUPABASE_ANON_KEY || window.SUPABASE_URL.includes("YOUR_") ||
          window.SUPABASE_ANON_KEY.includes("YOUR_")) {
        throw new Error("Supabase project URL or publishable key is not configured.");
      }

      if (!window.supabase || typeof window.supabase.createClient !== "function") {
        var sources = [
          "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
          "https://unpkg.com/@supabase/supabase-js@2/dist/umd/supabase.js"
        ];
        var loaded = false;
        var lastError = null;
        for (var i = 0; i < sources.length; i++) {
          try {
            await loadLibrary(sources[i]);
            loaded = true;
            break;
          } catch (error) {
            lastError = error;
            console.warn("Supabase library source failed.", error);
          }
        }
        if (!loaded) {
          throw new Error("Supabase library unavailable. Check CSP script-src permissions and browser console details. " +
            (lastError && lastError.message ? lastError.message : ""));
        }
      }

      window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });
      window.supabaseReady = true;
      return window.sb;
    })().catch(function (error) {
      window.sb = null;
      window.supabaseReady = false;
      window.supabaseInitPromise = null;
      throw error;
    });

    return window.supabaseInitPromise;
  };

  window.ensureSupabaseClient().catch(function (error) {
    console.warn("Supabase initialization did not complete; it can retry when needed.", error);
  });
}());
