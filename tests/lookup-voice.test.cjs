const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('mobile.html','utf8');
function context(chosen,fetch){let start=html.indexOf('  async function transcribe(blob,ctl,opt={})'),end=html.indexOf('  /* ---------- đọc biển số',start);assert(start>0&&end>start);let c={toWavBase64:async()=> 'base64wav',B:{Models:{resolve:(cfg,id)=>({providerLabel:'Test',endpoint:'https://example.invalid'}),getKey:async()=> 'key'}},cfg:()=>({}),lookupSelectedModel:()=>chosen,voiceCandidates:()=>[{id:'gemini:fallback',provider:'gemini',model:'gemini-fallback'}],TRANS_SYS:'transcription',TRANS_NONE:'KHONG_CO_LOI',S:{voice:null},AbortController,AbortSignal,DOMException,fetch};vm.createContext(c);vm.runInContext(html.slice(start,end)+';this.transcribe=transcribe;',c);return c;}
test('lookup voice sends audio to selected Gemini model',async()=>{let request;const c=context({id:'antigravity:gemini',provider:'antigravity',model:'gemini-3-flash'},async(url,opts)=>{request=JSON.parse(opts.body);return {ok:true,json:async()=>({choices:[{message:{content:'Cản trước Honda CR-V'}}]})}});const text=await c.transcribe({},new AbortController(),{lookup:true});assert.equal(text,'Cản trước Honda CR-V');assert.equal(request.model,'gemini-3-flash');assert.equal(request.messages[1].content[1].input_audio.data,'base64wav');});
test('lookup voice reports incompatible models and does not send audio',async()=>{let sent=0;const c=context({id:'antigravity:claude',provider:'antigravity',model:'claude-sonnet'},async()=>{sent++});await assert.rejects(()=>c.transcribe({},new AbortController(),{lookup:true}),/Gemini/);assert.equal(sent,0)});
test('no selected model uses Gemini voice candidates',async()=>{let model;const c=context(null,async(url,opts)=>{model=JSON.parse(opts.body).model;return {ok:true,json:async()=>({choices:[{message:{content:'Đèn pha trái'}}]})}});await c.transcribe({},new AbortController(),{lookup:true});assert.equal(model,'gemini-fallback')});

test('business voice sends WAV and planning instructions to the selected multimodal model',async()=>{
    const start=html.indexOf('  async function callVoiceModel('),end=html.indexOf('  async function transcribe(blob,ctl,opt={})',start);
    assert.ok(start>0&&end>start);
    const selected={provider:'antigravity',providerLabel:'Antigravity',model:'gemini-flash',endpoint:'https://example.invalid'};
    let posted;
    const ctx=vm.createContext({active:()=>selected,B:{Models:{getKey:async()=> 'test-only'}},voiceCandidates:()=>[],
        S:{voice:null},AbortSignal,DOMException,fetch:async(url,params)=>{
            posted={url,body:JSON.parse(params.body)};
            return {ok:true,json:async()=>({choices:[{message:{content:'{"route":"warehouse","transcript":"đèn hậu i10"}'}}]})};
        }});
    vm.runInContext(html.slice(start,end)+'this.call=callVoiceModel;',ctx);
    const request={system_instruction:{parts:[{text:'Lập kế hoạch tra kho'}]},contents:[{parts:[{text:'ngữ cảnh'}]}]};
    await ctx.call(request,'test-audio',new AbortController().signal);
    assert.equal(posted.url,selected.endpoint);
    assert.equal(posted.body.model,selected.model);
    assert.equal(posted.body.messages[0].content,'Lập kế hoạch tra kho');
    assert.deepEqual(posted.body.messages[1].content[1],{type:'input_audio',input_audio:{data:'test-audio',format:'wav'}});
    const cancelled=new AbortController();
    cancelled.abort();
    posted=null;
    await assert.rejects(()=>ctx.call(request,'test-audio',cancelled.signal),{name:'AbortError'});
    assert.equal(posted,null);
});
