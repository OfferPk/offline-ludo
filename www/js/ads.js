/*
 * Ad hooks. In a normal web browser every call is a no-op (rewarded ads simply
 * grant the reward, there is no banner/interstitial). Inside the Capacitor
 * Android app they use @capacitor-community/admob via Capacitor.Plugins.AdMob.
 *
 *  Ads.init()                      UMP consent + SDK init (no ad is shown)
 *  Ads.showBanner() / hideBanner() banner on the menu and gameplay screens (the layout reserves its space)
 *  Ads.maybeInterstitial(gate)     ONLY called after a match has ended (result screen -> Play again / Home); asks AdGate
 *  Ads.showRewarded(onReward)      ONLY called from a button tap; reward only if earned
 */
(function () {
  'use strict';
  var cfg = window.ADS_CONFIG || {};
  var initPromise = null;
  var rewardedBusy = false;
  var interstitialReady = false;
  var bannerShown = false;
  var privacyRequired = false;

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }
  function plugin() { return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AdMob; }

  function init() {
    if (initPromise) return initPromise;
    var AdMob = plugin();
    if (!isNative() || !AdMob) { initPromise = Promise.resolve(false); return initPromise; }
    initPromise = (async function () {
      try {
        // Google UMP consent first (EEA/UK/CH), before any ad request.
        var canRequest = true;
        try {
          var info = await AdMob.requestConsentInfo();
          if (info && info.isConsentFormAvailable && info.status === 'REQUIRED') info = await AdMob.showConsentForm();
          if (info) {
            if (info.canRequestAds === false) canRequest = false;
            privacyRequired = info.privacyOptionsRequirementStatus === 'REQUIRED';
          }
        } catch (e) { /* consent not configured - continue */ }
        await AdMob.initialize({ initializeForTesting: !!cfg.IS_TESTING });
        try {
          AdMob.addListener('bannerAdSizeChanged', function (size) {
            var h = size && size.height ? size.height : 0;
            document.documentElement.style.setProperty('--banner-h', h + 'px');
          });
        } catch (e) {}
        return canRequest;
      } catch (e) { console.warn('AdMob init failed', e); return false; }
    })();
    return initPromise;
  }

  async function showBanner() {
    if (!(await init())) return;
    try {
      if (bannerShown) { await plugin().resumeBanner(); }
      else {
        await plugin().showBanner({ adId: cfg.BANNER_ID, adSize: 'ADAPTIVE_BANNER', position: 'BOTTOM_CENTER', margin: 0, isTesting: !!cfg.IS_TESTING });
        bannerShown = true;
      }
      document.body.classList.add('has-banner');
    } catch (e) { console.warn('banner failed', e); }
  }
  async function hideBanner() {
    document.body.classList.remove('has-banner');
    document.documentElement.style.setProperty('--banner-h', '0px');
    if (!bannerShown || !(await init())) return;
    try { await plugin().hideBanner(); } catch (e) {}
  }

  /** Preload an interstitial (only when the gate says one may be due soon). */
  async function prepareInterstitial() {
    if (interstitialReady || !(await init())) return;
    try { await plugin().prepareInterstitial({ adId: cfg.INTERSTITIAL_ID, isTesting: !!cfg.IS_TESTING }); interstitialReady = true; }
    catch (e) { interstitialReady = false; }
  }

  /** Called ONLY after a match has ended (result screen). Returns true if an ad was shown. */
  async function maybeInterstitial(gate) {
    var now = Date.now();
    if (!gate || !gate.canShow(now)) return false;
    if (!(await init())) return false; // web: never
    if (!interstitialReady) { prepareInterstitial(); return false; } // never block the player waiting for a load
    try {
      interstitialReady = false;
      await plugin().showInterstitial();
      gate.shown(Date.now());
      return true;
    } catch (e) { console.warn('interstitial failed', e); return false; }
  }

  /**
   * Rewarded ad, started only from an explicit button tap. onReward() runs only
   * when the SDK reports the reward was earned. In a browser it runs immediately.
   */
  async function showRewarded(onReward, onNoFill) {
    if (rewardedBusy) return;
    var native = await init();
    if (!native) { if (!isNative()) { if (onReward) onReward(); } else if (onNoFill) onNoFill(); return; }
    rewardedBusy = true;
    var AdMob = plugin();
    var rewarded = false, handles = [];
    try {
      await AdMob.prepareRewardVideoAd({ adId: cfg.REWARDED_ID, isTesting: !!cfg.IS_TESTING });
      await new Promise(function (resolve) {
        var done = function () { setTimeout(resolve, 150); };
        Promise.all([
          AdMob.addListener('onRewardedVideoAdReward', function () { rewarded = true; }),
          AdMob.addListener('onRewardedVideoAdDismissed', done),
          AdMob.addListener('onRewardedVideoAdFailedToShow', done)
        ]).then(function (hs) { handles = hs; });
        // resolves on reward; if the user closes early only "Dismissed" fires
        AdMob.showRewardVideoAd().then(function () { rewarded = true; }).catch(done);
      });
    } catch (e) {
      console.warn('rewarded failed', e);
      if (onNoFill) onNoFill();
    } finally {
      rewardedBusy = false;
      handles.forEach(function (h) { try { h.remove(); } catch (e) {} });
    }
    if (rewarded && onReward) onReward();
  }

  async function showPrivacyOptions() {
    if (!(await init())) return;
    try { await plugin().showPrivacyOptionsForm(); } catch (e) {}
  }

  window.Ads = {
    init: init, isNative: isNative, showBanner: showBanner, hideBanner: hideBanner,
    prepareInterstitial: prepareInterstitial, maybeInterstitial: maybeInterstitial, showRewarded: showRewarded,
    showPrivacyOptions: showPrivacyOptions, privacyOptionsRequired: function () { return privacyRequired; }
  };
})();
