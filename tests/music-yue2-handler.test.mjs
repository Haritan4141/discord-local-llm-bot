import test from 'node:test';
import assert from 'node:assert/strict';
import { createYue2Handler } from '../src/music/yue2.mjs';

function history({truncated=false,actualDurationSec=145,maxDurationSec=360}={}) {
  return {id:{status:{status_str:'success',completed:true},outputs:{
    result_metadata:{yue2_result:[{metadataAvailable:true,abcNonempty:true,truncated,actualDurationSec,
      frames:Math.round(actualDurationSec*25),targetDurationSec:120,maxDurationSec}]},
    save_mp3:{audio:[{filename:'test.mp3',subfolder:'audio',type:'output'}]},
    save_flac:{audio:[{filename:'test.flac',subfolder:'audio',type:'output'}]},
  }}};
}
function setup(result=history()) {
  const edits=[],calls=[];
  const client={
    request:async()=>({DiscordYuE2Result:{}}),
    submit:async wf=>{calls.push(wf);return'id';},
    history:async()=>result,audio:async()=>Buffer.from('mp3'),
  };
  const job={prompt:'song',lyrics:'hello world',durationSec:120,interaction:{editReply:async p=>edits.push(p),attachmentSizeLimit:1000}};
  return {client,job,edits,calls};
}
test('handler keeps over-target audio and surfaces capped/natural metadata',async()=>{
  for(const truncated of [false,true]) {
    const h=setup(history({truncated}));
    await createYue2Handler({client:h.client,settings:{maxDurationSec:360}})(h.job);
    assert.equal(h.calls[0].music.inputs.max_duration,360);
    assert.match(h.edits.at(-1).content,/実際: 145.00秒/);
    assert.equal(h.edits.at(-1).files.length,1);
    assert.equal(h.edits.at(-1).content.includes('上限に到達'),truncated);
  }
});
test('handler rejects missing extension before generation and mismatched metadata',async()=>{
  const h=setup();h.client.request=async()=>({});
  await assert.rejects(createYue2Handler({client:h.client,settings:{maxDurationSec:360}})(h.job),/extension/);
  assert.equal(h.calls.length,0);
  const bad=setup(history({maxDurationSec:240}));
  await assert.rejects(createYue2Handler({client:bad.client,settings:{maxDurationSec:360}})(bad.job),/does not match/);
});
test('timeout neither resubmits nor interrupts remote work',async()=>{
  const h=setup({});let time=0;
  await assert.rejects(createYue2Handler({client:h.client,settings:{maxDurationSec:360},now:()=>time,sleep:async()=>{time+=10;},timeoutMs:20})(h.job),{code:'MUSIC_RESULT_TIMEOUT'});
  assert.equal(h.calls.length,1);
});
