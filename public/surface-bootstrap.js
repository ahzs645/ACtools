(function () {
  try {
    // The Alayaduck desktop app injects `acBridge` from its preload script
    // before any page script runs, so its presence identifies the host.
    if (window.acBridge) {
      document.documentElement.dataset.surface = "desktop";
      return;
    }
    var params = new URLSearchParams(window.location.search);
    if (params.get("surface") === "popup") {
      document.documentElement.dataset.surface = "popup";
    }
  } catch (error) {
    // Default to sidepanel surface if parsing fails.
  }
})();
