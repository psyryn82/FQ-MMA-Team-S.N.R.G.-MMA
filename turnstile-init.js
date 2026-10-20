(function () {
  "use strict";

  window.onTurnstileLoaded = function () {
    const renderWidgets = function () {
      document.querySelectorAll(".cf-turnstile[data-sitekey]").forEach(function (widget) {
        if (!window.turnstile || widget.dataset.widgetId) return;
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
