(function () {
    'use strict';

    var galleryTitle = document.getElementById('gallery-title');
    var mainImage = document.getElementById('main-image');
    var extraSection = document.getElementById('extra-section');
    var extraGrid = document.getElementById('extra-grid');
    var noExtras = document.getElementById('no-extras');
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

    // Mostra immagine a schermo intero
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
        if (e.target === modalFullscreen) {
            hideFullscreen();
        }
    });

    // Carica e mostra i dati
    async function loadGallery() {
        try {
            var assoc = await JarDB.get(qrId);
            if (!assoc) {
                document.getElementById('gallery-content').innerHTML =
                    '<p style="text-align:center;padding:40px;color:#fca5a5;">Associazione non trovata per: ' + qrId + '</p>';
                return;
            }

            // Immagine principale
            if (assoc.imageBlob) {
                var mainUrl = URL.createObjectURL(assoc.imageBlob);
                mainImage.src = mainUrl;
                mainImage.addEventListener('click', function () {
                    showFullscreen(mainUrl);
                });
            }

            // Immagini secondarie
            var extras = assoc.extraImages || [];
            if (extras.length > 0) {
                extraSection.classList.remove('hidden');
                noExtras.classList.add('hidden');

                for (var i = 0; i < extras.length; i++) {
                    var url = URL.createObjectURL(extras[i]);
                    var img = document.createElement('img');
                    img.className = 'extra-thumb';
                    img.src = url;
                    img.alt = 'Immagine ' + (i + 1);
                    img.addEventListener('click', (function (u) {
                        return function () { showFullscreen(u); };
                    })(url));
                    extraGrid.appendChild(img);
                }
            } else {
                extraSection.classList.add('hidden');
                noExtras.classList.remove('hidden');
            }
        } catch (err) {
            console.error('Errore caricamento galleria:', err);
            document.getElementById('gallery-content').innerHTML =
                '<p style="text-align:center;padding:40px;color:#fca5a5;">Errore: ' + err.message + '</p>';
        }
    }

    loadGallery();
})();
