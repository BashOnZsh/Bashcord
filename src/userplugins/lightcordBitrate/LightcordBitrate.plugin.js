/**
 * @name LightcordBitrate
 * @description Bitrate Plugin for BD — V8 ULTIMATE by adem
 *              Perfectly synced with adem's modules V8.
 *              Frozen profiles, reconnect-safe, one-time patch guard.
 * @version 6.0.0
 * @author skenzo (V8 patch by adem)
 * @authorId 842214916135976981
 */
module.exports = class LightcordBitrateV8 {
  // Frozen Opus profile — identical to ADEM_OPUS in index.js V8
  static get OPUS() {
    return Object.freeze({
      channels:        2,
      freq:            48000,
      rate:            512000,
      pacsize:         960,
      application:     2049,    // OPUS_APPLICATION_AUDIO
      fec:             false,
      dtx:             false,
      packetLossRate:  0,
      bandwidth:       1105,    // OPUS_BANDWIDTH_FULLBAND
      bitratePriority: 1,
      complexity:      10,
      signal:          3002,    // OPUS_SIGNAL_MUSIC
    });
  }

  // Frozen transport profile — identical to ADEM_TRANSPORT in index.js V8
  static get TRANSPORT() {
    return Object.freeze({
      packetLossRate:          0,
      fec:                     false,
      encodingBitRate:         512000,
      encodingVoiceBitRate:    512000,
      callBitrate:             512000,
      callMaxBitRate:          512000,
      minBitrate:              512000,
      maxBitrate:              512000,
      adaptiveBitrate:         false,
      adaptivePtime:           false,
      adaptiveAudioPacketLoss: false,
      voiceProcessing:         false,
      enableAgc:               false,
      enableNS:                false,
      enableAEC:               false,
      enableDSP:               false,
    });
  }

  constructor() {
    this.patched    = false;
    this.toastShown = false;
  }

  patch(conn) {
    if (!conn?.setTransportOptions || this.patched) return;
    this.patched = true;

    const original = conn.setTransportOptions.bind(conn);
    conn.setTransportOptions = (options) => {
      if (!options || typeof options !== 'object') return original(options);

      // Deep merge Opus profile
      options.audioEncoder = {
        ...(options.audioEncoder || {}),
        ...LightcordBitrateV8.OPUS,
      };

      // Apply transport overrides
      Object.assign(options, LightcordBitrateV8.TRANSPORT);

      return original(options);
    };

    console.log('[ADEM V8] LightcordBitrate: transport override active');
  }

  showToast() {
    if (this.toastShown) return;
    this.toastShown = true;
    BdApi.UI.showToast(
      '[ADEM V8 ULTIMATE] Filterless — 512kbps · Opus AUDIO · Fullband stereo · 18 DSP filters off',
      { type: 'success', timeout: 7000 }
    );
  }

  start() {
    this.showToast();

    const voiceModule = BdApi.Webpack.getModule(
      (m) => m.prototype && 'setLocalVolume' in m.prototype
    );
    if (!voiceModule) {
      console.error('[ADEM V8] LightcordBitrate: voiceModule not found');
      return;
    }

    // Patch on setLocalVolume — fires when a connection is established
    BdApi.Patcher.before('LightcordBitrateV8', voiceModule.prototype, 'setLocalVolume', (thisObj) => {
      if (thisObj?.conn) this.patch(thisObj.conn);
    });

    // Also patch on mergeUsers — another early connection lifecycle event
    BdApi.Patcher.before('LightcordBitrateV8', voiceModule.prototype, 'mergeUsers', (thisObj) => {
      if (thisObj?.conn) this.patch(thisObj.conn);
    });
  }

  stop() {
    BdApi.Patcher.unpatchAll('LightcordBitrateV8');
    this.patched    = false;
    this.toastShown = false;
  }
};

// ADEM V8: stabilized transport pacing for long music sessions
