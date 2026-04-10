(function () {
  try {
    var params = new URLSearchParams(window.location.search);
    if (params.get("surface") === "popup") {
      document.documentElement.dataset.surface = "popup";
    }
  } catch (error) {
    // Default to sidepanel surface if parsing fails.
  }
})();
