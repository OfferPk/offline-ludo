'use strict';
const assert = require('node:assert/strict');
const LocalPeer = require('../www/js/local-peer.js');

class FakeChannel {
  constructor() { this.readyState = 'connecting'; this.peer = null; this.sent = []; }
  send(s) { if (this.readyState !== 'open') throw new Error('not open'); this.sent.push(s); if (this.peer && this.peer.onmessage) this.peer.onmessage({data:s}); }
  open() { this.readyState='open'; if(this.onopen) this.onopen(); }
  close() { this.readyState='closed'; if(this.onclose) this.onclose(); }
}
class FakePC {
  static all = [];
  constructor(config) { assert.deepEqual(config, {iceServers:[]}); this.iceGatheringState='complete'; this.connectionState='new'; this.localDescription=null; this.remoteDescription=null; FakePC.all.push(this); }
  createDataChannel() { const c=new FakeChannel(); this.out=c; return c; }
  async createOffer() { return {type:'offer',sdp:'fake-offer'}; }
  async createAnswer() { return {type:'answer',sdp:'fake-answer'}; }
  async setLocalDescription(d) { this.localDescription=d; }
  async setRemoteDescription(d) { this.remoteDescription=d; if (d.type === 'offer' && this.ondatachannel) { this.incoming=new FakeChannel(); this.ondatachannel({channel:this.incoming}); } }
  close() { this.connectionState='closed'; if(this.onconnectionstatechange) this.onconnectionstatechange(); }
}
function pair() {
  const host = new LocalPeer({role:'host',RTCPeerConnection:FakePC,connectTimeout:100,iceTimeout:100});
  const join = new LocalPeer({role:'joiner',RTCPeerConnection:FakePC,connectTimeout:100,iceTimeout:100});
  return {host,join};
}
(async () => {
  assert.equal(LocalPeer.MAX_SIGNAL,32768); assert.equal(LocalPeer.MAX_MESSAGE,16384);
  const {host,join}=pair();
  const offer = await host.createOffer();
  const decoded = LocalPeer.decodeSignal(offer);
  assert.equal(decoded.type,'offer'); assert.equal(decoded.nonce,host.nonce);
  assert.equal(LocalPeer.decodeSignal(LocalPeer.encodeSignal(decoded)).nonce,host.nonce);
  const answer=await join.acceptOffer(offer); assert.equal(LocalPeer.decodeSignal(answer).type,'answer');
  await host.acceptAnswer(answer);
  assert.deepEqual(FakePC.all.map(p=>p.localDescription.type),['offer','answer']);
  // Link the fake channels, then exercise open/status and data validation.
  const hc=host.channel; const jc=FakePC.all[1].incoming; assert.ok(jc); hc.peer=jc; jc.peer=hc; hc.open(); jc.open();
  const received=[]; host.onMessage=m=>received.push(['h',m]); join.onMessage=m=>received.push(['j',m]);
  join.send({kind:'action',action:'roll',queueIndex:0,revision:0});
  join.send({kind:'action',action:'move',piece:1,queueIndex:0,revision:0});
  assert.equal(received.length,2); assert.equal(received[0][1].action,'roll');
  const state={mode:'classic',players:[0,1],pieces:[[-1,-1,-1,-1],[-1,-1,-1,-1],null,null],turn:1,phase:'roll',queue:[],ranking:[],rules:{}};
  host.send({kind:'state',revision:1,state}); assert.equal(received.length,3); assert.equal(received[2][1].revision,1);
  host.channel.send(JSON.stringify({v:1,nonce:host.nonce,kind:'state',revision:1,state}));
  assert.equal(join.lastRevision,1);
  assert.throws(()=>host.send({kind:'state',revision:1,state}),/increase/);
  assert.throws(()=>join.send({kind:'state',revision:2,state}),/only host/);
  assert.throws(()=>host.send({kind:'action',action:'roll',queueIndex:0,revision:1}),/only joiner/);
  assert.throws(()=>join.send({kind:'action',action:'move',piece:4,queueIndex:0,revision:1}),/invalid/);
  assert.equal(LocalPeer.validateAction({kind:'action',action:'roll',queueIndex:0,revision:0}),true);
  assert.equal(LocalPeer.validateAction({kind:'action',action:'move',piece:0,queueIndex:3,revision:0}),true);
  assert.equal(LocalPeer.validateAction({kind:'action',action:'move',piece:0,revision:0}),false);
  assert.equal(LocalPeer.validateState({kind:'state',revision:0,state}),true);
  assert.equal(LocalPeer.validateState({kind:'state',revision:0,state:null}),false);
  const badNonce=JSON.stringify({v:1,nonce:'x',kind:'action',action:'roll',queueIndex:0,revision:0});
  join.channel.send(badNonce); assert.equal(join.lastRevision,1);
  join.channel.send('{bad');
  assert.throws(()=>LocalPeer.decodeSignal('not base64'),/signal|malformed/);
  const mismatched = LocalPeer.encodeSignal({nonce:'0123456789abcdef0123456789abcdef',type:'answer',description:{type:'answer',sdp:'x'}});
  await assert.rejects(()=>host.acceptAnswer(mismatched),/mismatched answer/);
  assert.throws(()=>host.send({kind:'action',action:'roll',queueIndex:0,revision:1}),/only joiner/);
  host.close(); join.close(); assert.equal(host.pc,null); assert.equal(host.channel,null); assert.equal(join.pc,null);
  // Oversized signaling and messages are rejected without network access.
  assert.throws(()=>LocalPeer.encodeSignal({nonce:host.nonce,type:'offer',description:{type:'offer',sdp:'x'.repeat(40000)}}),/size/);
  const status=[]; const p=new LocalPeer({role:'joiner',RTCPeerConnection:FakePC,onStatus:s=>status.push(s)});
  p._attach(new FakeChannel()); p.channel.open();
  p.channel.onmessage({data:'x'.repeat(LocalPeer.MAX_MESSAGE+1)}); assert.equal(status.at(-1),'rejected'); p.close();
  console.log('local-peer tests passed');
})().catch(err=>{ console.error(err); process.exitCode=1; });
