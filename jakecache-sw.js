'use strict';


import { md5 } from './lib/md5'

self.importScripts("idb-keyval-iife.js");

const manifestStore = new idbKeyval.Store("manifest-db", "manifest-db");

class JakeCacheManifest {
    constructor(data) {
        this.cache = null;
        this._path = null;
        this._hash = null;
        this._isValid = false;
        this._fetchOptions = { credentials: "same-origin" };
        this._rawData = {
            version: "",
            cache: [],
            fallback: [],
            network: []
        };

        if (data) {
            this.restoreManifest(data);
        }
    }

    hash() {
        return this._hash;
    }
    isValid() {
        return this._isValid;
    }
    manifestData() {
        return {
            cacheName: this.cacheName(),
            path: this._path,
            hash: this._hash,
            isValid: this._isValid,
            rawData: this._rawData
        };
    }

    restoreManifest(manifestData) {
        if (!manifestData) {
            this._isValid = false;
            return;
        }
        this._path = manifestData.path;
        this._hash = manifestData.hash;
        this._rawData = manifestData.rawData;

        this.restoreCache();
    }

    restoreCache() {
        this.cache = ["jakecache.js", "idb-keyval-iife.js"];
        this.searchCache = {};
        let tmp = {};
        // Ignore different protocol
        for (let pathname of this._rawData.cache) {
            let path = new URL(pathname, location);
            if (path.protocol === location.protocol) {
                if (!tmp[path]) {
                    this.cache.push(path);
                    tmp[path] = path;

                    this.searchCache[path.pathname] = 1;
                }
            }
        }

        this.fallback = [];
        for (let entry of this._rawData.fallback) {
            let [pathname, fallbackPath] = entry.split(" ");
            let path = new URL(pathname, location);
            let fallback = new URL(fallbackPath, location);

            // Ignore cross-origin fallbacks
            if (path.origin === fallback.origin) {
                this.fallback.push([path, fallback]);
                this.cache.push(fallback);
            }
        }

        this.allowNetworkFallback = false;
        this.network = [];
        for (let entry of this._rawData.network) {
            if (entry === "*") {
                this.allowNetworkFallback = true;
                continue;
            }
            let path = new URL(entry, location);
            if (path.protocol === location.protocol) {
                this.network.push(path);
            }
        }

        this._isValid = true;
    }

    shouldBeCached(url) {
        return url.pathname.endsWith('.js') || this.searchCache[url.pathname];
    }

    pathName() {
        return this._path;
    }

    cacheName() {
        let version = this._rawData.version;
        return version + "_" + this._hash;
    }

    cache() {
        return this.cache;
    }

    fetchData(path, options = {}) {
        this._path = path;

        if (this._isValid && options.cache !== "reload") {
            return Promise.resolve(false);
        }

        const ms = Date.now();
        let url = this._path;
        if (url.indexOf('?') === -1) {
            url += "?_=" + ms;
        } else {
            url += "&_=" + ms;
        }
        // http://html5doctor.com/go-offline-with-application-cache/
        return fetch(new Request(url, options), this._fetchOptions).then(
            response => {
                if (
                    response.type === "opaque" ||
                    response.status === 404 ||
                    response.status === 410
                ) {
                    return Promise.reject();
                }

                this._prevhash = options.hash ? options.hash : null;

                return response.text().then(result => {
                    return new Promise((resolve, reject) => {
                        let hash = md5(result);

                        this._hash = hash;

                        let lines = result.split(/\r|\n/);
                        let header = "cache"; // default.
                        let versionRegexp = /\s*(#\sVersion:)\s*([\w\.]*)/gm;

                        let firstLine = lines.shift();
                        if (firstLine !== "CACHE MANIFEST") {
                            return reject();
                        }
                        let versionFound = false;
                        for (let line of lines) {
                            if (!versionFound) {
                                let match = versionRegexp.exec(line);
                                if (match) {
                                    versionFound = true;
                                    this._rawData.version = match[match.length - 1];
                                }
                            }

                            line = line.replace(/#.*$/, "").trim();

                            if (line === "") {
                                continue;
                            }

                            let res = line.match(/^([A-Z]*):/);
                            if (res) {
                                header = res[1].toLowerCase();
                                continue;
                            }

                            if (!this._rawData[header]) {
                                this._rawData[header] = [];
                            }
                            this._rawData[header].push(line);
                        }

                        if (!versionFound) {
                            this._rawData.version = "" + new Date().getTime();
                        }

                        this.restoreCache();

                        if (this._prevhash && hash.toString() === this._prevhash.toString()) {
                            console.log(`JakeCache-SW no manifest update: ${hash}`);
                            return resolve(false);
                        }

                        console.log(`JakeCache-SW manifest update: ${hash} (was: ${this._prevhash})`);

                        resolve(true);
                    });
                });
            }
        );
    }
}

const isAutoUpdate = true;

const CacheStatus = {
    UNCACHED: 0,
    IDLE: 1,
    CHECKING: 2,
    DOWNLOADING: 3,
    UPDATEREADY: 4,
    OBSOLETE: 5
};

let manifest = null;
let cacheStatus = CacheStatus.UNCACHED;

function postMessage(msg) {
    //    { includeUncontrolled: true, type: 'window' }
    return self.clients.matchAll().then(clients => {

        if (!clients.length) {
            console.log(`JakeCache-SW no clients!! message:`, msg);
        }

        return Promise.all(
            clients.map(client => {
                return client.postMessage(msg);
            })
        );
    });
}

async function storeManifest(newManifest, manifestVersion) {
    manifestVersion = manifestVersion || "current";

    await idbKeyval.set(manifestVersion, newManifest.manifestData(), manifestStore);

    return Promise.resolve(newManifest);
}

async function loadManifest(manifestVersion) {
    try {
        manifestVersion = manifestVersion || "current";

        const mnfstData = await idbKeyval.get("current", manifestStore);
        if (!mnfstData) {
            return Promise.resolve(null);
        }

        let manifest = new JakeCacheManifest(mnfstData);
        return Promise.resolve(manifest);
    } catch (err) {
        console.log(`JakeCache-SW error ${err}`);
        return Promise.reject(err);
    }
}


async function loadCurrentManifest() {
    const mnf = await loadManifest("current");
    if (!mnf) {
        manifest = null;
        cacheStatus = CacheStatus.UNCACHED;
        console.log("JakeCache-SW uncached ");
        return Promise.resolve(null);
    }

    manifest = mnf;
    cacheStatus = CacheStatus.CACHED;
    return Promise.resolve(manifest);
}

async function deleteOldCaches() {
    let cacheWhitelist = [];
    if (!manifest) {
        manifest = await loadCurrentManifest();
    }
    if (manifest) {
        cacheWhitelist.push(manifest.cacheName());
    }

    const nextManifest = await loadManifest("next");
    if (nextManifest) {
        cacheWhitelist.push(nextManifest.cacheName());
    }

    console.log('JakeCache-SW deleteing old caches except:', cacheWhitelist);

    const cacheNames = await caches.keys();
    return Promise.all(
        cacheNames.map(function (cacheName) {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
                return caches.delete(cacheName);
            }
        }));
}

let updating = false;

async function update(pathname, options = {}) {
    if (!pathname) {
        console.log("JakeCache-SW No pathname!");
        return Promise.reject('No pathname');
    }

    if (updating) {
        console.log("JakeCache-SW already updating");
        return Promise.reject('already updating');
    }

    updating = true;

    let nextManifest = new JakeCacheManifest();
    self.options = options;

    let manifestVersion = 'current';

    try {
        if (!manifest) {
            manifest = await loadCurrentManifest();
        }

        if (manifest) {
            self.options.hash = manifest.hash();
        }

        let isNeededToUpdate = await nextManifest.fetchData(pathname, self.options);

        // check keys in cache
        if (!isNeededToUpdate) {
            const cache = await caches.open(nextManifest.cacheName());
            const keys = await cache.keys();
            if (keys.length < nextManifest.cache.length) {
                console.log(`JakeCache-SW cache has less entries then should be, updating cache`);
                isNeededToUpdate = true;
            }
        }

        if (isNeededToUpdate) {
            console.log(`JakeCache-SW storing to cache ${nextManifest.cacheName()} `);
            const cache = await caches.open(nextManifest.cacheName());
            await cache.addAll(nextManifest.cache);

            let isUpgrade = manifest //&& !isAutoUpdate;
            if (isUpgrade) {
                manifestVersion = 'next';
            }

            console.log(`JakeCache-SW stored to cache ${nextManifest.cacheName()} `);
            await storeManifest(nextManifest, manifestVersion);
            console.log(`JakeCache-SW saved to indexed db ${nextManifest.cacheName()} `);

            if (isAutoUpdate) {
                console.log(`JakeCache-SW Auto Update`);
                swapCache();
            }
            else if (isUpgrade) {
                cacheStatus = CacheStatus.UPDATEREADY;
                postMessage({ type: "updateready" });
            }

            updating = false;
            return Promise.resolve();
        } else {
            updating = false;
            cacheStatus = CacheStatus.CACHED;
            return Promise.resolve('JakeCache-SW noupdate needed');
        }
    }
    catch (err) {
        updating = false;
        console.log(`JakeCache-SW error: ${err}`);

        if (manifest) {
            cacheStatus = CacheStatus.CACHED;
            postMessage({ type: "noupdate" });
        } else {
            cacheStatus = CacheStatus.IDLE;
            postMessage({ type: "idle" });
        }
        return Promise.reject(err);
    }
}

async function swapCache() {

    try {
        if (!manifest) {
            manifest = await loadCurrentManifest();
        }

        const mnfstNextData = await idbKeyval.get("next", manifestStore);

        if (mnfstNextData) {
            await idbKeyval.set("current", mnfstNextData, manifestStore);
            manifest = new JakeCacheManifest(mnfstNextData);

            await idbKeyval.del("next", manifestStore);

            try {
                await deleteOldCaches();
            } catch (err) {
                console.log(`JakeCache-SW deleteOldCaches error: ${err}`);
            }

            console.log(`JakeCache-SW swapCache done`);

            postMessage({ type: "updated" });
        } else {
            console.log(`JakeCache-SW no manifest to update to`);
        }

        if (!manifest) {
            cacheStatus = CacheStatus.UNCACHED;
        } else {
            cacheStatus = CacheStatus.CACHED;
        }
    }
    catch (err) {
        console.log(`JakeCache-SW swapCache error: ${err}`);

        if (mnfstNextData) {
            cacheStatus = CacheStatus.UPDATEREADY;
            postMessage({ type: "updateready" });
        } else {
            cacheStatus = CacheStatus.UNCACHED;
            postMessage({ type: "error" });
        }

        return Promise.reject(err);
    }
}

const manifestName = 'app.manifest';

function getManifestUrl() {
    let loc = location.pathname.replace(/([\w\-]+\.js)/, manifestName);
    return loc;
}

self.addEventListener("message", function (event) {
    let loc = getManifestUrl();

    switch (event.data.command) {
        case "update":
            let path = event.data.pathname || loc;
            update.call(this, path, event.data.options);
            break;
        case "abort":
            postMessage({
                type: "error",
                message: "Not implementable without cancellable promises."
            });
            break;
        case "swapCache":
            swapCache();
            break;
    }
});

self.addEventListener("install", function (event) {
    let loc = getManifestUrl();

    event.waitUntil(
        update(loc, { cache: "reload" })
            .catch((e) => Promise.resolve())
            .finally(() => self.skipWaiting())
    );
});

self.addEventListener("activate", async function (event) {
    event.waitUntil(
        deleteOldCaches()
            .then(function () {
                self.clients.claim();
            })
    );

});

function fromNetwork(request) {
    return fetch(request);
}

async function fromCache(request) {

    let cacheName = '';
    if (!manifest) {
        manifest = await loadCurrentManifest();
    }

    if (!updating && !manifest) {
        // try recache if no manifest
        let loc = getManifestUrl();
        update(loc, { cache: "reload" });
    }

    if (cacheStatus !== CacheStatus.CACHED) {
        return Promise.reject('no-cache');
    }

    if (manifest) {
        cacheName = manifest.cacheName();
    }

    if (!cacheName) {
        return Promise.reject('no-cache');
    }

    let url = new URL(request.url);
    if (request.mode === 'navigate') {
        //make normilized url without query 
        url.search = '';
        url.hash = '';
    }

    return caches.open(cacheName).then((cache) =>
        cache.match(url).then((matching) =>
            matching || Promise.reject('no-match')
        ));
}

// to refresh cache
async function updateCache(request, response) {
    let url = new URL(request.url);

    if (cacheStatus !== CacheStatus.CACHED) {
        return Promise.resolve();
    }

    let cacheName = '';
    if (!manifest) {
        manifest = await loadCurrentManifest();
    }

    if (manifest) {
        cacheName = manifest.cacheName();
    }

    if (!cacheName) {
        return Promise.reject('no-cache');
    }

    if (!manifest || !manifest.shouldBeCached(url)) {
        return Promise.resolve();
    }

    console.log(`JakeCache-SW add to cache ${request.url}`);
    return caches.open(cacheName).then((cache) =>
        cache.put(request, response)
    );
}

function shouldInterceptRequest(url) {
    return false;
}

self.addEventListener("fetch", function (event) {
    let url = new URL(event.request.url);
    // console.log(url);

    if (event.request.url.includes("sw-fetch-test")) {
        event.respondWith(new Response('{"result": "ok"}', {
            headers: {
                "status": 200,
                "statusText": "service worker response",
                'Content-Type': 'application/json'
            }
        }));
        return;
    }

    const interceptRequest = shouldInterceptRequest(url);
    if (interceptRequest) {
        event.respondWith(async function () {
            return await fromNetwork(event.request);
        }());
        return;
    }

    // Ignore non-GET and different schemes.
    if (
        (event.request.cache === 'only-if-cached' && event.request.mode !== 'same-origin' ||
            !event.request.url.startsWith(self.location.origin) ||
            event.request.method !== "GET" ||
            url.protocol !== location.protocol)
    ) {
        return;
    }

    event.respondWith(async function () {

        try {
            return await fromCache(event.request);
        } catch (e) {
            const resp = await fromNetwork(event.request);
            let respClone = resp.clone();
            event.waitUntil(async function () {
                await updateCache(event.request, respClone);
            }());
            return resp;
        }
    }());

});
