import test from 'node:test';
import assert from 'node:assert/strict';
import { createComfyClient } from '../src/music/comfy-client.mjs';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
test('free validates backend queue before posting and refuses busy or malformed state', async () => {
  for (const state of [{queue_running:[[1]],queue_pending:[]}, {}]) {
    const calls=[];
    const client=createComfyClient('http://localhost:8191',{fetchImpl:async(url,options)=>{calls.push({url,options}); return json(state);}});
    await assert.rejects(client.free());
    assert.equal(calls.length,1);
    assert.match(calls[0].url,/\/queue$/);
  }
});
test('free requests unload only after an empty queue', async () => {
  const calls=[];
  const client=createComfyClient('http://localhost:8191',{fetchImpl:async(url,options)=>{
    calls.push({url,options});return json(url.endsWith('/queue')?{queue_running:[],queue_pending:[]}:{});
  }});
  await client.free();
  assert.deepEqual(JSON.parse(calls[1].options.body),{unload_models:true,free_memory:true});
});
test('submit does not retry failures or rejected nodes', async () => {
  let calls=0;
  const client=createComfyClient('http://localhost:8191',{fetchImpl:async()=>{calls++;return json({prompt_id:'id',node_errors:{bad:{}}});}});
  await assert.rejects(client.submit({}));assert.equal(calls,1);
});

test('free accepts an empty success body but queue must still return JSON', async () => {
  const client = createComfyClient('http://localhost:8191', { fetchImpl: async url =>
    url.endsWith('/queue') ? json({ queue_running: [], queue_pending: [] }) : new Response('', { status: 200 }) });
  assert.equal(await client.free(), null);
  const emptyClient = createComfyClient('http://localhost:8191', { fetchImpl: async () => new Response('') });
  await assert.rejects(emptyClient.queue());
});
test('audio enforces declared and streamed size limits and rejects empty body', async () => {
  for(const response of [
    new Response('12345',{headers:{'content-length':'5'}}),new Response('12345'),new Response(''),
  ]){
    const client=createComfyClient('http://localhost:8191',{fetchImpl:async()=>response});
    await assert.rejects(client.audio({filename:'song.mp3',type:'output'},4));
  }
});
test('audio accepts bounded output and encodes file query', async () => {
  let called;
  const client=createComfyClient('http://localhost:8191',{fetchImpl:async url=>{called=url;return new Response('123');}});
  assert.equal((await client.audio({filename:'a b.mp3',subfolder:'audio/yue2',type:'output'},8)).length,3);
  assert.equal(new URL(called).searchParams.get('filename'), 'a b.mp3');
});
test('request timeout covers response headers and no automatic retries', async () => {
  let calls=0;
  const client=createComfyClient('http://localhost:8191',{timeoutMs:10,fetchImpl:async(_url,{signal})=>{
    calls++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('aborted'))));
  }});
  await assert.rejects(client.queue(),/aborted/);assert.equal(calls,1);
});
