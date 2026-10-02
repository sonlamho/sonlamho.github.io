/* Photo gallery: builds the thumbnail grid from window.PHOTOS (see
   photos-data.js) and shows a full-screen viewer when a photo is selected. */
(function () {
  'use strict';

  var PHOTO_FOLDER = 'photos/';
  var photos = Array.isArray(window.PHOTOS) ? window.PHOTOS.filter(function (p) {
    return p && typeof p.src === 'string' && p.src !== '';
  }) : [];

  var gallery = document.getElementById('gallery');
  var dialog = document.getElementById('lightbox');
  var image = document.getElementById('lightbox-image');
  var caption = document.getElementById('lightbox-caption');
  var count = document.getElementById('lightbox-count');
  var stage = document.getElementById('lightbox-stage');
  var prevButton = document.getElementById('lightbox-prev');
  var nextButton = document.getElementById('lightbox-next');
  var closeButton = document.getElementById('lightbox-close');
  if (!gallery || !dialog) return;

  var current = 0;
  var thumbs = [];

  function photoUrl(photo) {
    /* Full URLs and absolute paths are used as given; plain file names are
       looked up in the photos folder. */
    return /^(https?:)?\/\//.test(photo.src) || photo.src.charAt(0) === '/'
      ? photo.src
      : PHOTO_FOLDER + photo.src;
  }

  /* Captions may contain HTML such as a link; this gives the words alone. */
  function plainText(html) {
    var holder = document.createElement('div');
    holder.innerHTML = html || '';
    return holder.textContent.trim();
  }

  function altText(photo, index) {
    return photo.alt || plainText(photo.caption) || 'Photo ' + (index + 1);
  }

  if (photos.length === 0) {
    var empty = document.createElement('p');
    empty.className = 'gallery-empty';
    empty.textContent = 'No photos yet.';
    gallery.replaceWith(empty);
    return;
  }

  photos.forEach(function (photo, index) {
    var item = document.createElement('li');
    item.className = 'photo';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'thumb';
    button.setAttribute('aria-haspopup', 'dialog');

    var img = document.createElement('img');
    img.src = photoUrl(photo);
    img.alt = altText(photo, index);
    img.loading = 'lazy';
    img.decoding = 'async';
    button.appendChild(img);

    button.addEventListener('click', function () {
      open(index);
    });

    item.appendChild(button);

    /* The caption sits outside the button so that a link in it can be
       followed. */
    if (photo.caption) {
      var text = document.createElement('p');
      text.className = 'caption';
      text.innerHTML = photo.caption;
      item.appendChild(text);
    }

    gallery.appendChild(item);
    thumbs.push(button);
  });

  function show(index) {
    current = (index + photos.length) % photos.length;
    var photo = photos[current];
    image.src = photoUrl(photo);
    image.alt = altText(photo, current);
    caption.innerHTML = photo.caption || '';
    count.textContent = (current + 1) + ' / ' + photos.length;
  }

  function open(index) {
    show(index);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
      closeButton.focus();
    } else {
      /* Very old browsers without <dialog>: open the image directly. */
      window.location.href = photoUrl(photos[current]);
    }
  }

  var single = photos.length < 2;
  prevButton.hidden = single;
  nextButton.hidden = single;

  prevButton.addEventListener('click', function () {
    show(current - 1);
  });
  nextButton.addEventListener('click', function () {
    show(current + 1);
  });
  closeButton.addEventListener('click', function () {
    dialog.close();
  });

  /* A click on the dark area around the photo closes the viewer. */
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog || event.target === stage || event.target === caption) {
      dialog.close();
    }
  });

  dialog.addEventListener('keydown', function (event) {
    if (single) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      show(current - 1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      show(current + 1);
    }
  });

  /* Return focus to the thumbnail of the photo that was last shown. */
  dialog.addEventListener('close', function () {
    if (thumbs[current]) thumbs[current].focus();
  });
})();
