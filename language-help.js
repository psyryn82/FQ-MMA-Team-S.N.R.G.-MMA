/* No-cost public-page translation launcher.
 * Uses Google's hosted page-translation URL; no API key, paid API, billing,
 * third-party script, or site-content collection is added by this code.
 * Translation is provided by Google Translate and may affect interactive forms.
 */
(() => {
  "use strict";
  const languages = [
    ["es", "Español"],
    ["ar", "العربية (Arabic)"],
    ["fa", "فارسی (Persian/Farsi)"],
    ["ps", "پښتو (Pashto)"],
    ["tr", "Türkçe (Turkish)"],
    ["ur", "اردو (Urdu)"],
    ["he", "עברית (Hebrew)"],
    ["fr", "Français (French)"],
    ["pt", "Português (Portuguese)"],
    ["de", "Deutsch (German)"],
    ["ru", "Русский (Russian)"],
    ["hi", "हिन्दी (Hindi)"],
    ["bn", "বাংলা (Bengali)"],
    ["zh-CN", "简体中文 (Chinese)"],
    ["ja", "日本語 (Japanese)"],
    ["ko", "한국어 (Korean)"],
    ["vi", "Tiếng Việt (Vietnamese)"],
    ["so", "Soomaali (Somali)"]
  ];

  function mount() {
    if (!document.body || document.getElementById("fq-language-help")) return;
    const panel = document.createElement("aside");
    panel.id = "fq-language-help";
    panel.setAttribute("aria-label", "Page translation");
    panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9998;max-width:calc(100vw - 24px);padding:9px 11px;border:1px solid #8a8f98;border-radius:10px;background:#101216;color:#fff;box-shadow:0 4px 18px #0005;font:500 13px/1.4 system-ui,sans-serif;display:flex;align-items:center;gap:8px";
    const mobileStyle = document.createElement("style");
    mobileStyle.textContent = "@media(max-width:640px){#fq-language-help{right:8px!important;bottom:8px!important;padding:6px 8px!important;gap:5px!important;max-width:calc(100vw - 16px)!important}#fq-language-help label{font-size:12px;cursor:pointer}#fq-language-select{display:none;max-width:44vw!important;min-height:30px!important;font-size:12px!important}#fq-language-help.expanded #fq-language-select{display:block}}";
    document.head.appendChild(mobileStyle);
    const label = document.createElement("label");
    label.htmlFor = "fq-language-select";
    label.textContent = "🌐 Translate";
    label.style.cssText = "white-space:nowrap;font-weight:700";
    const select = document.createElement("select");
    select.id = "fq-language-select";
    select.setAttribute("aria-label", "Choose a language to translate this page");
    select.style.cssText = "max-width:min(56vw,220px);min-height:34px;border-radius:6px;padding:4px 6px;background:#fff;color:#151515;font:inherit";
    const initial = document.createElement("option");
    initial.value = "";
    initial.textContent = "Choose language";
    select.appendChild(initial);
    for (const [code, name] of languages) {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = name;
      select.appendChild(option);
    }
    label.setAttribute("role", "button");
    label.tabIndex = 0;
    label.setAttribute("aria-expanded", "false");
    const toggleMobileSelect = () => {
      if (!window.matchMedia("(max-width: 640px)").matches) return;
      const expanded = panel.classList.toggle("expanded");
      label.setAttribute("aria-expanded", String(expanded));
      if (expanded) select.focus();
    };
    label.addEventListener("click", toggleMobileSelect);
    label.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggleMobileSelect();
      }
    });
    select.addEventListener("change", () => {
      if (!select.value) return;
      // Avoid sending query-string values that could contain temporary IDs or tokens.
      const publicUrl = new URL(window.location.href);
      publicUrl.search = "";
      publicUrl.hash = "";
      const target = "https://translate.google.com/translate?sl=auto&tl="
        + encodeURIComponent(select.value) + "&u=" + encodeURIComponent(publicUrl.toString());
      window.location.assign(target);
    });
    panel.append(label, select);
    document.body.appendChild(panel);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  } else {
    mount();
  }
})();