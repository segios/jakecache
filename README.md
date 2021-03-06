# JakeCache

Declarative manifest-driven app cache built on top of ServiceWorker.

[![Build status](https://travis-ci.org/kenchris/jakecache.svg?branch=master)](https://travis-ci.org/kenchris/jakecache)
[![js-standard-style](https://img.shields.io/badge/code%20style-standard-brightgreen.svg?style=flat)](https://github.com/feross/standard)

![](https://raw.githubusercontent.com/kenchris/jakecache/master/.jakecache.gif)

## Why?

Building offline-first applications has been the ubiquius dream since the early days of the web. Google started by introducing Google Gears, and later followed the web community by building [Application Cache](https://www.w3.org/TR/2011/WD-html5-20110525/offline.html).

Application Cache was a great step forward, but had several fundamental flaws that were made famous by [Jake Archibald](https://twitter.com/jaffathecake)'s epic [Application Cache is a Douchebag](http://alistapart.com/article/application-cache-is-a-douchebag) article and [talk](https://www.youtube.com/watch?v=cR-TP6jOSQM). So Jake, [Alex Russell](https://twitter.com/slightlylate) and many others, have been busy working on the next generation of application caching API's which today are know as the [Service Worker Specification](https://github.com/slightlyoff/ServiceWorker).

Service Worker is great, but if you ever had a look at it's API(s) you realize that they are complicated imperative JavaScript API's. These API's tend to scare many web developers who prefer a nice forgiving declarative approach.

So in order to **fix** the **too** complicated Service Worker API, we are super excited to introduce **JakeCache**. A declarative manifest-driven application cache for web applications implemented on top of ServiceWorker.

*Sarcasm may occur in this project*

😂

### Polyfill

JakeCache serves the additional purpose of being as compatible with the HTML5 Application Cache (aka AppCache) as we could make it and may serve as a polyfill in browsers removing such support.

Patches are welcome!

## Installation

```bash
npm install jakecache --save
```

## Get started

1. Create a new JakeCache Manifest, `app.manifest` and save it in your root together with the `jakecache.js` file:
```
CACHE MANIFEST
# 2010-06-18:v2

# Explicitly cached 'master entries'.
CACHE:
/test.html

# Resources that require the user to be online.
NETWORK:
*
```

1. sample setup 
``` 
            function injectJakeCacheScript() {
                var s = document.createElement('script');
                s.type = 'text/javascript';
                s.async = true;
                s.src = '@Url.Content("~/jakecache.js")';
                var ss = document.getElementsByTagName('script')[0];
                ss.parentNode.insertBefore(s, ss);
            }
            
            function setUpCachehandlers() {
                if (!('serviceWorker' in navigator)) {
                    console.log('no serviceWorker');
                    return;
                }

                if (!window.jakeCache) {
                    setTimeout(setUpCachehandlers, 500);
                    return;
                }

                window.jakeCache.addEventListener('downloading', function (ev) {
                    console.log('JakeCache downloading');

                });

                window.jakeCache.addEventListener('cached', function (ev) {
                    console.log('JakeCache cached');

                });

                window.jakeCache.addEventListener('sw-not-attached', function (ev) {
                    console.log('JakeCache Service worker not attached !!!');

                });

                window.jakeCache.addEventListener('checking', function (ev) {
                    console.log('JakeCache checking');

                });

                window.jakeCache.addEventListener('updateready', function (ev) {
                    console.log('JakeCache updateready');
                    window.jakeCache.swapCache();
                });

                window.jakeCache.addEventListener('updated', function (ev) {
                    console.log('JakeCache updated');
                    var url = window.location.href;

                    // reload to root of application
                    if (window.location.href.indexOf('#') > 0) {
                        url = window.location.href.substr(0, window.location.href.indexOf('#')) ;
                    }
                    if (url && !url.endsWith('/')) {
                        url += '/';
                    }
                    window.location = url;
                });

                window.jakeCache.addEventListener('error', function (ev) {
                    console.log(ev.message);
                });

                console.log('jakeCache handlers were setup');
            }

            if ('serviceWorker' in navigator) {
                injectJakeCacheScript();
                setUpCachehandlers();
            }        
            
```
2. Add ```<html manifest="app.manifest">``` to your HTML.
3. If name of the manifest is different change it in 'jakecahce-sw.js'  
```
const manifestName = 'app.manifest';
```
4. optional parameter in 'jakecahce-sw.js' 
``` 
const isAutoUpdate = false;
```
Means  autoupdate cache without message to SwapCahce
5. That's it! Your website is now Jake-enabled!

## License

See [LICENSE.md](https://github.com/kenchris/jakecache/blob/master/LICENSE.md)

### About this project
This is a project by [Kenneth Christiansen](https://twitter.com/kennethrohde) & [Kenneth Auchenberg](https://twitter.com/auchenberg) and a result of too much 🍺 and ☕.
