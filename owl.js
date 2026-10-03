/* Bhippiee owl: the eyes follow the cursor (or a finger). Plain JS, no
 * dependencies. Pupil-glint positions were measured on the real logo with
 * circle detection (iris centres at 33.2% / 66.8% across, 38.6% down), not
 * eyeballed. Respects prefers-reduced-motion: with it on, the owl stays put. */
(function () {
  var owl = document.getElementById('owl');
  if (!owl) return;
  var eyes = [
    { x: 0.332, y: 0.386, el: document.getElementById('glintL') },
    { x: 0.668, y: 0.386, el: document.getElementById('glintR') },
  ];
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var MOVE = 0.028;   // how far a glint may drift inside the iris, as a fraction of the logo width
  var last = null;

  function look(cx, cy) {
    last = [cx, cy];
    var r = owl.getBoundingClientRect();
    if (!r.width) return;
    eyes.forEach(function (e) {
      if (!e.el) return;
      var dx = cx - (r.left + e.x * r.width), dy = cy - (r.top + e.y * r.height);
      var dist = Math.hypot(dx, dy) || 1;
      var reach = Math.min(MOVE * r.width, dist * 0.15);
      e.el.style.left = e.x * 100 + '%';
      e.el.style.top = e.y * 100 + '%';
      e.el.style.transform = 'translate(-50%,-50%) translate(' + (dx / dist) * reach + 'px,' + (dy / dist) * reach + 'px)';
    });
    if (!reduce) {  // a small head turn toward the pointer, clamped so it reads as "watching"
      var hx = cx - (r.left + r.width / 2), hy = cy - (r.top + r.height / 2);
      var tx = Math.max(-7, Math.min(7, hy / 40)), ty = Math.max(-7, Math.min(7, -hx / 40));
      owl.style.transform = 'perspective(700px) rotateX(' + tx + 'deg) rotateY(' + ty + 'deg)';
    }
  }

  if (!reduce) {
    window.addEventListener('pointermove', function (e) { look(e.clientX, e.clientY); }, { passive: true });
    window.addEventListener('touchmove', function (t) {
      var p = t.touches && t.touches[0]; if (p) look(p.clientX, p.clientY);
    }, { passive: true });
    window.addEventListener('resize', function () { if (last) look(last[0], last[1]); });
  }
  // Rest pose after layout is committed (calling earlier measured a 0-width box in testing).
  requestAnimationFrame(function () { look(window.innerWidth / 2, window.innerHeight * 0.45); });
})();
