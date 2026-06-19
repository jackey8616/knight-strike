// Entry router. The DEFAULT game is v1 (the original prototype — its look and
// feel is the one we ship); `?v2` boots the v2 Lord Monarch economy game. Both
// modules self-bootstrap on import over the same #app mount, so we import
// exactly one.
if (new URLSearchParams(window.location.search).has("v2")) {
  void import("./main-v2");
} else {
  void import("./main-v1");
}
