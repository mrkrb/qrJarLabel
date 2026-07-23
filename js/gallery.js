(function () {
    'use strict';

    var galleryTitle = document.getElementById('gallery-title');
    var mainImage = document.getElementById('main-image');
    var mainPlaceholder = document.getElementById('main-placeholder');
    var mainContainer = document.getElementById('main-image-container');
    var extraGrid = document.getElementById('extra-grid');
    var fileInput = document.getElementById('file-input');
    var modalFullscreen = document.getElementById('modal-fullscreen');
    var fullscreenImage = document.getElementById('fullscreen-image');
    var btnCloseFullscreen = document.getElementById('btn-close-fullscreen');

    // Leggi qrId dal parametro URL
    var params = new URLSearchParams(window.location.search);
    var qrId = params.get('qr');

    if (!qrId) {
        galleryTitle.textContent = 'Errore';
        document.getElementById('gallery-content').innerHTML =
            '<p style="text-align:center;padding:40px;color:#fca5a5;">Nessun QR code specificato.</p>';
        return;
    }

    galleryTitle.textContent = qrId;

    // Stato upload
    var uploadTarget = null; // 'main' o 'extra'

    // =========================================================================
    // FULLSCREEN
    // =========================================================================

    function showFullscreen(url) {
        fullscreenImage.src = url;
        modalFullscreen.classList.remove('hidden');
    }

    function hideFullscreen() {
        modalFullscreen.classList.add('hidden');
        fullscreenImage.src = '';
    }

    btnCloseFullscreen.addEventListener('click', hideFullscreen);
    modalFullscreen.addEventListener('click', function (e) {
        if (e.target === modalFullscreen) hideFullscreen();
    });

    // =========================================================================
    // RESIZE IMMAGINE
    // =========================================================================

    function resizeImage(file, maxSize) {
        return new Promise(function (resolve, reject) {
            var url = URL.createObjectURL(file);
            var img = new Image();
            img.onload = function () {
                var w = img.naturalWidth;
                var h = img.naturalHeight;
                if (w > maxSize || h > maxSize) {
                    if (w >= h) {
                        h = Math.round(h * (maxSize / w));
                        w = maxSize;
                    } else {
                        w = Math.round(w * (maxSize / h));
                        h = maxSize;
                    }
                }
                var canvas = document.createElement('canvas');
                canvas.width = w;
                canvas.height = h;
                var c = canvas.getContext('2d');
                c.drawImage(img, 0, 0, w, h);
                URL.revokeObjectURL(url);
                canvas.toBlob(function (blob) {
                    if (blob) resolve(blob);
                    else reject(new Error('Errore conversione'));
                }, 'image/jpeg', 0.85);
            };
            img.onerror = function () {
                URL.revokeObjectURL(url);
                reject(new Error('Errore caricamento immagine'));
            };
            img.src = url;
        });
    }

    // =========================================================================
    // RENDER GALLERIA
    // =========================================================================

    async function loadGallery() {
        var assoc = await JarDB.get(qrId);

        // Immagine principale
        if (assoc && assoc.imageBlob) {
            var mainUrl = URL.createObjectURL(assoc.imageBlob);
            mainImage.src = mainUrl;
            mainImage.classList.remove('hidden');
            mainPlaceholder.classList.add('hidden');

            mainImage.onclick = function () { showFullscreen(mainUrl); };

            // Long-press per sostituire l'immagine principale
            var longPressTimer = null;
            mainContainer.addEventListener('touchstart', function (e) {
                longPressTimer = setTimeout(function () {
                    uploadTarget = 'main';
                    fileInput.click();
                }, 600);
            }, { passive: true });
            mainContainer.addEventListener('touchend', function () {
                clearTimeout(longPressTimer);
            });
            mainContainer.addEventListener('touchmove', function () {
                clearTimeout(longPressTimer);
            });
        } else {
            // Nessuna immagine principale: mostra placeholder
            mainImage.classList.add('hidden');
            mainPlaceholder.classList.remove('hidden');

            mainPlaceholder.addEventListener('click', function () {
                uploadTarget = 'main';
                fileInput.click();
            });
        }

        // Immagini secondarie
        renderExtraGrid(assoc);
    }

    function renderExtraGrid(assoc) {
        extraGrid.innerHTML = '';

        var extras = (assoc && assoc.extraImages) ? assoc.extraImages : [];

        // Mostra le immagini extra esistenti
        for (var i = 0; i < extras.length; i++) {
            var url = URL.createObjectURL(extras[i]);
            var wrapper = document.createElement('div');
            wrapper.className = 'extra-item';

            var img = document.createElement('img');
            img.className = 'extra-thumb';
            img.src = url;
            img.alt = 'Immagine ' + (i + 1);

            // Tocco: fullscreen
            (function (u) {
                img.addEventListener('click', function () { showFullscreen(u); });
            })(url);

            // Pulsante elimina
            var btnDel = document.createElement('button');
            btnDel.className = 'extra-delete';
            btnDel.innerHTML = '&#10005;';
            btnDel.setAttribute('aria-label', 'Rimuovi');
            (function (index) {
                btnDel.addEventListener('click', function (e) {
                    e.stopPropagation();
                    removeExtra(index);
                });
            })(i);

            wrapper.appendChild(img);
            wrapper.appendChild(btnDel);
            extraGrid.appendChild(wrapper);
        }

        // Placeholder "+" per aggiungere una nuova immagine secondaria
        var addPlaceholder = document.createElement('div');
        addPlaceholder.className = 'extra-item extra-add';
        addPlaceholder.innerHTML = '<span>+</span>';
        addPlaceholder.addEventListener('click', function () {
            uploadTarget = 'extra';
            fileInput.click();
        });
        extraGrid.appendChild(addPlaceholder);
    }

    // =========================================================================
    // UPLOAD E ELIMINAZIONE
    // =========================================================================

    fileInput.addEventListener('change', async function () {
        var file = fileInput.files[0];
        if (!file) return;
        fileInput.value = '';

        try {
            var blob = await resizeImage(file, 1024);

            if (uploadTarget === 'main') {
                await JarDB.save(qrId, blob);
            } else {
                // Se non esiste ancora l'associazione, creala prima
                var existing = await JarDB.get(qrId);
                if (!existing) {
                    await JarDB.save(qrId, blob);
                } else {
                    await JarDB.addExtra(qrId, blob);
                }
            }

            // Ricarica galleria
            window.location.reload();
        } catch (err) {
            console.error('Errore upload:', err);
            alert('Errore: ' + err.message);
        }
    });

    async function removeExtra(index) {
        if (!confirm('Rimuovere questa immagine?')) return;
        try {
            await JarDB.removeExtra(qrId, index);
            window.location.reload();
        } catch (err) {
            alert('Errore: ' + err.message);
        }
    }

    // =========================================================================
    // INIT
    // =========================================================================

    loadGallery();
})();
