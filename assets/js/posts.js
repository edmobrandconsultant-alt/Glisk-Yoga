/* Play buttons for the self-hosted posts.
 *
 * The videos carry no `controls` attribute to begin with, so the poster reads as
 * a clean preview rather than a still with a control bar across it. The first
 * click starts playback and hands over to the browser's own controls from there.
 * Without JavaScript the button simply isn't shown and the video falls back to
 * native controls, so the posts still play.
 */
(function () {
  'use strict';

  document.querySelectorAll('[data-player]').forEach(function (player) {
    var video = player.querySelector('video');
    var button = player.querySelector('.post-play');
    if (!video || !button) return;

    player.classList.add('is-ready');

    button.addEventListener('click', function () {
      video.controls = true;
      player.classList.add('is-playing');
      var started = video.play();
      // A rejected play (missing file, autoplay policy) must not leave the card
      // stuck with no way back to the poster.
      if (started && started.catch) {
        started.catch(function () {
          player.classList.remove('is-playing');
          video.controls = true;
        });
      }
    });

    video.addEventListener('ended', function () { player.classList.remove('is-playing'); });
  });
})();
