/**
 * Modulo IndexedDB per la persistenza delle associazioni QR → immagine.
 *
 * Ogni record ha la forma:
 *   { qrId: string, imageBlob: Blob, createdAt: number }
 *
 * Lo store usa qrId come keyPath (un QR = un'immagine).
 */
var JarDB = (function () {
    'use strict';

    var DB_NAME = 'qr-jar-label-db';
    var DB_VERSION = 1;
    var STORE_NAME = 'associations';

    var dbPromise = null;

    /**
     * Apre (o crea) il database. Restituisce una Promise<IDBDatabase>.
     */
    function open() {
        if (dbPromise) return dbPromise;

        dbPromise = new Promise(function (resolve, reject) {
            var request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = function (event) {
                var db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'qrId' });
                }
            };

            request.onsuccess = function (event) {
                resolve(event.target.result);
            };

            request.onerror = function (event) {
                console.error('Errore apertura IndexedDB:', event.target.error);
                reject(event.target.error);
            };
        });

        return dbPromise;
    }

    /**
     * Salva un'associazione QR → immagine (crea o sovrascrive).
     * @param {string} qrId - Identificativo del QR code (rawValue)
     * @param {Blob} imageBlob - Immagine come Blob
     * @returns {Promise<void>}
     */
    function saveAssociation(qrId, imageBlob) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var record = {
                    qrId: qrId,
                    imageBlob: imageBlob,
                    createdAt: Date.now()
                };
                var request = store.put(record);
                request.onsuccess = function () { resolve(); };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Recupera un'associazione per qrId.
     * @param {string} qrId
     * @returns {Promise<{qrId, imageBlob, createdAt}|null>}
     */
    function getAssociation(qrId) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.get(qrId);
                request.onsuccess = function () {
                    resolve(request.result || null);
                };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Recupera tutte le associazioni.
     * @returns {Promise<Array<{qrId, imageBlob, createdAt}>>}
     */
    function getAllAssociations() {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readonly');
                var store = tx.objectStore(STORE_NAME);
                var request = store.getAll();
                request.onsuccess = function () {
                    resolve(request.result || []);
                };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    /**
     * Elimina un'associazione.
     * @param {string} qrId
     * @returns {Promise<void>}
     */
    function deleteAssociation(qrId) {
        return open().then(function (db) {
            return new Promise(function (resolve, reject) {
                var tx = db.transaction(STORE_NAME, 'readwrite');
                var store = tx.objectStore(STORE_NAME);
                var request = store.delete(qrId);
                request.onsuccess = function () { resolve(); };
                request.onerror = function (e) { reject(e.target.error); };
            });
        });
    }

    // API pubblica
    return {
        open: open,
        save: saveAssociation,
        get: getAssociation,
        getAll: getAllAssociations,
        delete: deleteAssociation
    };
})();
