/**
 * Legacy loader for older references.
 *
 * The app now boots from /static/main.js as an ES module.
 */
(function loadMainModule() {
  const script = document.createElement("script");
  script.type = "module";
  script.src = "/static/main.js";
  document.head.appendChild(script);
})();
