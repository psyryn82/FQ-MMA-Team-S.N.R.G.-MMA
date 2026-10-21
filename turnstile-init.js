(function () {
  "use strict";

  window.onTurnstileLoaded = function () {
    const renderWidgets = function () {
      document.querySelectorAll(".cf-turnstile[data-sitekey]").forEach(function (widget) {
        if (widget.dataset.widgetId) return;
        const sitekey = String(widget.dataset.sitekey || "").trim();
        if (!sitekey || /REPLACE_WITH|YOUR_SITE_KEY|PLACEHOLDER/i.test(sitekey)) {
          const form = widget.closest("form");
          const status = form && form.querySelector('[role="status"]');
          widget.innerHTML = '<p class="text-sm text-red-400">Online security verification is not configured. Please use the direct email link below.</p>';
          if (status) {
            status.textContent = "Online security verification is not configured yet. Use the direct email option below.";
            status.className = "text-sm text-red-400";
          }
          return;
        }
        if (!window.turnstile) return;
        try {
          widget.dataset.widgetId = window.turnstile.render(widget, {
            sitekey: widget.dataset.sitekey,
            action: widget.dataset.action,
            callback: function () {},
            "error-callback": function () {
              const form = widget.closest("form");
              const status = form && form.querySelector('[role="status"]');
              if (status) status.textContent = "Security check unavailable. Please refresh and try again.";
            }
          });
        } catch (_) {
          const form = widget.closest("form");
          const status = form && form.querySelector('[role="status"]');
          if (status) status.textContent = "Security check unavailable. Please refresh and try again.";
        }
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", renderWidgets, { once: true });
    } else {
      renderWidgets();
    }
  };
})();
