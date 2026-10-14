/* Local-only WebRTC transport for same-Wi-Fi play. No signaling/network services are used. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LocalPeer = factory();
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  var VERSION = 1;
  var MAX_SIGNAL = 32768;
  var MAX_MESSAGE = 16384;
  var ICE_TIMEOUT = 8000;
  var CONNECT_TIMEOUT = 120000;
  var hasOwn = Object.prototype.hasOwnProperty;

  function bytes(s) { return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : unescape(encodeURIComponent(s)).length; }
  function jsonSize(v) { return bytes(JSON.stringify(v)); }
  function randomNonce() { var a = new Uint8Array(16); if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a); else for (var i=0;i<a.length;i++) a[i] = Math.floor(Math.random()*256); return Array.from(a, function(x){return x.toString(16).padStart(2,'0');}).join(''); }
  function b64(s) { if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s))); return Buffer.from(s,'utf8').toString('base64'); }
  function unb64(s) { if (typeof atob === 'function') return decodeURIComponent(escape(atob(s))); return Buffer.from(s,'base64').toString('utf8'); }
  function encodeSignal(signal) {
    var x = { v: VERSION, nonce: signal.nonce, type: signal.type, description: signal.description };
    var out = b64(JSON.stringify(x));
    if (bytes(out) > MAX_SIGNAL) throw new Error('signal exceeds size limit');
    return out;
  }
  function decodeSignal(text) {
    if (typeof text !== 'string' || bytes(text) > MAX_SIGNAL || !text.trim()) throw new Error('invalid signal');
    var x; try { x = JSON.parse(unb64(text.trim())); } catch (_) { throw new Error('malformed signal'); }
    if (!x || x.v !== VERSION || (x.type !== 'offer' && x.type !== 'answer') || typeof x.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(x.nonce) || !x.description || typeof x.description.type !== 'string' || typeof x.description.sdp !== 'string') throw new Error('invalid signal');
    return x;
  }
  function validAction(a) {
    if (!a || a.kind !== 'action' || (a.action !== 'roll' && a.action !== 'move')) return false;
    if (!Number.isSafeInteger(a.revision) || a.revision < 0 || !Number.isInteger(a.queueIndex) || a.queueIndex < 0 || a.queueIndex > 3) return false;
    if (a.action === 'move' && (!Number.isInteger(a.piece) || a.piece < 0 || a.piece > 3)) return false;
    if (a.action === 'roll' && a.queueIndex !== 0) return false;
    return true;
  }
  function validState(s) {
    var st = s && s.state;
    if (!s || s.kind !== 'state' || !Number.isSafeInteger(s.revision) || s.revision < 0 || !st || st.mode !== 'classic') return false;
    if (!Array.isArray(st.players) || st.players.length !== 2 || st.players.some(function (seat) { return !Number.isInteger(seat) || seat < 0 || seat > 3; }) || st.players[0] === st.players[1]) return false;
    if (!Array.isArray(st.pieces) || st.pieces.length !== 4 || !Array.isArray(st.queue) || st.queue.length > 3 || !Array.isArray(st.ranking)) return false;
    if (!Number.isInteger(st.turn) || st.players.indexOf(st.turn) < 0 || ['roll', 'move', 'over'].indexOf(st.phase) < 0) return false;
    if (st.queue.some(function (v) { return !Number.isInteger(v) || v < 1 || v > 12; })) return false;
    return true;
  }

  function LocalPeer(options) {
    options = options || {};
    this.role = options.role || null;
    if (this.role !== 'host' && this.role !== 'joiner') this.role = null;
    this.nonce = options.nonce || randomNonce();
    if (!/^[0-9a-f]{32}$/.test(this.nonce)) throw new Error('nonce must be 16-byte hex');
    this.RTCPeerConnection = options.RTCPeerConnection || (typeof RTCPeerConnection !== 'undefined' && RTCPeerConnection);
    this.iceTimeout = options.iceTimeout || ICE_TIMEOUT;
    this.connectTimeout = options.connectTimeout || CONNECT_TIMEOUT;
    this.onStatus = options.onStatus || function(){};
    this.onMessage = options.onMessage || function(){};
    this.pc = null; this.channel = null; this.timer = null; this.connectTimer = null; this.closed = false; this.lastRevision = -1;
  }
  LocalPeer.VERSION = VERSION; LocalPeer.MAX_SIGNAL = MAX_SIGNAL; LocalPeer.MAX_MESSAGE = MAX_MESSAGE;
  LocalPeer.encodeSignal = encodeSignal; LocalPeer.decodeSignal = decodeSignal;
  LocalPeer.validateAction = validAction; LocalPeer.validateState = validState;
  LocalPeer.prototype.status = function(s, detail) { try { this.onStatus(s, detail); } catch (_) {} };
  LocalPeer.prototype._clear = function() { if (this.timer) clearTimeout(this.timer); if (this.connectTimer) clearTimeout(this.connectTimer); this.timer = this.connectTimer = null; };
  LocalPeer.prototype._fail = function(reason) { this.status('failed', reason); this.close(); };
  LocalPeer.prototype._make = function() {
    if (!this.RTCPeerConnection) throw new Error('RTCPeerConnection unavailable');
    this.pc = new this.RTCPeerConnection({iceServers: []});
    var self = this;
    this.pc.onicecandidate = function(e) { if (!e.candidate) self._iceDone(); };
    this.pc.onconnectionstatechange = function() { if (self.pc && (self.pc.connectionState === 'failed' || self.pc.connectionState === 'closed')) self._fail(self.pc.connectionState); };
    this.pc.ondatachannel = function(e) { self._attach(e.channel); };
    return this.pc;
  };
  LocalPeer.prototype._iceDone = function() { if (this.timer) { clearTimeout(this.timer); this.timer = null; } if (this._iceResolve) { var r=this._iceResolve; this._iceResolve=null; r(); } };
  LocalPeer.prototype._gather = function() { var self=this; return new Promise(function(resolve, reject) { self._iceResolve=resolve; self.timer=setTimeout(function(){ self._iceResolve=null; reject(new Error('ICE gathering timeout')); }, self.iceTimeout); if (!self.pc || self.pc.iceGatheringState === 'complete') self._iceDone(); }); };
  LocalPeer.prototype._attach = function(ch) { if (this.closed) { try { ch.close(); } catch (_) {} return; } this.channel=ch; var self=this; ch.onopen=function(){ if(self.connectTimer){clearTimeout(self.connectTimer);self.connectTimer=null;} self.status('connected'); }; ch.onclose=function(){self.status('closed');}; ch.onerror=function(){self._fail('channel error');}; ch.onmessage=function(e){self._receive(e.data);}; if(ch.readyState==='open') this.status('connected'); else { this.status('connecting'); if(this.role==='joiner') this._setupWait(); } };
  LocalPeer.prototype._setupWait = function() { var self=this; if (this.connectTimer) clearTimeout(this.connectTimer); if(this.channel && this.channel.readyState==='open') { this.status('connected'); return; } this.status('connecting'); this.connectTimer=setTimeout(function(){ if(!self.channel || self.channel.readyState!=='open') self._fail('channel connecting timeout'); }, this.connectTimeout); };
  LocalPeer.prototype.createOffer = async function() { if (this.role && this.role!=='host') throw new Error('only host creates offers'); this.role='host'; var pc=this._make(); this._attach(pc.createDataChannel('ludo',{ordered:true})); var offer=await pc.createOffer(); await pc.setLocalDescription(offer); await this._gather(); return encodeSignal({v:VERSION,nonce:this.nonce,type:'offer',description:pc.localDescription || offer}); };
  LocalPeer.prototype.acceptAnswer = async function(signal) { if (this.role!=='host' || !this.pc) throw new Error('host offer not created'); var x=typeof signal==='string'?decodeSignal(signal):signal; if(x.type!=='answer'||x.nonce!==this.nonce) throw new Error('mismatched answer'); await this.pc.setRemoteDescription(x.description); this._setupWait(); return true; };
  LocalPeer.prototype.acceptOffer = async function(signal) { if (this.role && this.role!=='joiner') throw new Error('peer already host'); var x=typeof signal==='string'?decodeSignal(signal):signal; if(!x || x.type!=='offer' || !/^[0-9a-f]{32}$/.test(x.nonce) || !x.description || typeof x.description.sdp!=='string') throw new Error('invalid offer'); this.role='joiner'; this.nonce=x.nonce; var pc=this._make(); await pc.setRemoteDescription(x.description); var answer=await pc.createAnswer(); await pc.setLocalDescription(answer); await this._gather(); this._setupWait(); return encodeSignal({v:VERSION,nonce:this.nonce,type:'answer',description:pc.localDescription || answer}); };
  LocalPeer.prototype._receive = function(raw) { if (typeof raw !== 'string' || bytes(raw)>MAX_MESSAGE) return this.status('rejected','message too large'); var m; try {m=JSON.parse(raw);} catch(_){return this.status('rejected','malformed message');} if(!m || m.v!==VERSION || m.nonce!==this.nonce) return this.status('rejected','mismatched message'); if(validAction(m)){ if(this.role==='joiner') return this.status('rejected','joiner cannot receive action'); return this.onMessage(m); } if(validState(m)){ if(this.role==='host') return this.status('rejected','host cannot receive state'); if(m.revision<=this.lastRevision) return this.status('stale',m.revision); this.lastRevision=m.revision; return this.onMessage(m); } return this.status('rejected','invalid message'); };
  LocalPeer.prototype.send = function(message) { if(!this.channel || this.channel.readyState!=='open') throw new Error('channel is not open'); var m=Object.assign({},message,{v:VERSION,nonce:this.nonce}); if(validState(m)){ if(this.role!=='host') throw new Error('only host may send state'); if(m.revision<=this.lastRevision) throw new Error('state revision must increase'); this.lastRevision=m.revision; } else if(validAction(m)){ if(this.role!=='joiner') throw new Error('only joiner may send actions'); } else throw new Error('invalid message'); var raw=JSON.stringify(m); if(bytes(raw)>MAX_MESSAGE) throw new Error('message exceeds size limit'); this.channel.send(raw); };
  LocalPeer.prototype.close = function() { this._clear(); this.closed=true; if(this.channel){try{this.channel.close();}catch(_){}} if(this.pc){try{this.pc.close();}catch(_){}} this.channel=null; this.pc=null; this.status('closed'); };
  return LocalPeer;
}));
