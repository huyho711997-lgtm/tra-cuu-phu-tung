const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const OCR=require('../registration-ocr.js');
const field=value=>({value,confidence:.95});
const fields=(brand,model,year)=>({brand:field(brand),model:field(model),year:field(year)});
const catalog={brands:[{name:'TOYOTA',models:['VIOS E','VIOS G','CAMRY']},{name:'HONDA',models:['CR-V','CIVIC']},{name:'MERCEDES BENZ',models:['C200']}],years:[2024,2023,2022]};
test('OCR extracts only vehicle fields, with strict production year and bounded confidence',()=>{
 const raw='```json\n'+JSON.stringify({brand:{value:' HONDA ',confidence:4},model:{value:'CR-V',confidence:-1},year:{value:2024,confidence:.9},owner:'ignore',vin:'ignore'})+'\n```';
 assert.deepEqual(OCR.normalizeResponse(raw),{brand:{value:'HONDA',confidence:1},model:{value:'CR-V',confidence:0},year:{value:'2024',confidence:.9}});
 assert.equal(OCR.normalizeResponse('{"year":{"value":"23/11/2026"}}').year.value,'');
 assert.equal(OCR.normalizeResponse('{"brand":null,"model":"null","year":"not visible"}').model.value,'');
 assert.throws(()=>OCR.normalizeResponse('No information'));
 assert.throws(()=>OCR.normalizeResponse('{bad JSON}'));
});
test('punctuation-normalized matching maps vehicle to real catalog names',()=>{
 assert.deepEqual(OCR.matchVehicle(fields('Honda','CR V','2024'),catalog),{brand:'HONDA',model:'CR-V',candidates:['CR-V'],year:'2024'});
 assert.equal(OCR.matchVehicle(fields('Mercedes','C200','2023'),catalog).brand,'MERCEDES BENZ');
});
test('ambiguous family, unknown brand and model codes are never guessed',()=>{
 const ambiguous=OCR.matchVehicle(fields('Toyota','Vios','2024'),catalog);
 assert.equal(ambiguous.model,'');assert.equal(ambiguous.candidates.length,2);
 assert.equal(OCR.matchVehicle(fields('Toyota','NCP150L','2024'),catalog).model,'');
 assert.equal(OCR.matchVehicle(fields('Toyo','CAMRY','2024'),catalog).brand,'');
 assert.equal(OCR.matchVehicle(fields('Toyota','Vioss','2024'),catalog).model,'');
 assert.equal(OCR.matchVehicle(fields('Honda','CR V','2030'),catalog).year,'');
});
const html=fs.readFileSync('mobile.html','utf8');
function readFn(){const a=html.indexOf('  async function readInspection('),b=html.indexOf('  /* ---------- AI đọc ảnh hiện trường',a);assert.ok(a>0&&b>a);return html.slice(a,b);}
function aiContext(fetchImpl){
 let owner='owner';const selected={id:'antigravity:gemini',provider:'antigravity',model:'gemini',profile:{vision:true}};
 const context={AbortController,DOMException,setTimeout,clearTimeout,api:{me:()=>({uid:owner})},loadBundle:async()=>{},plateImage:async()=> 'data:image/jpeg;base64,AA',B:{Models:{getKey:async()=> 'test-key',resolve:()=>({endpoint:'https://test.invalid',providerLabel:'Antigravity'})}},cfg:()=>({}),active:()=>selected,voiceCandidates:()=>[selected],ORDER_OK:()=>true,window:{TascoRegistrationOCR:OCR},fetch:fetchImpl};
 vm.createContext(context);vm.runInContext(readFn()+'\nthis.readInspection=readInspection;',context);
 return {read:context.readInspection,setOwner:value=>{owner=value}};
}
const photo={type:'image/jpeg',size:1000};
test('image request returns review fields and uses shared authenticated AI endpoint',async()=>{
 let request;const c=aiContext(async(url,opts)=>{request={url,opts};return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(fields('Honda','CR-V','2024'))}}]})}});
 const result=await c.read(photo);
 assert.equal(result.fields.brand.value,'Honda');assert.equal(request.opts.method,'POST');
 const body=JSON.parse(request.opts.body);assert.equal(body.messages[1].content[1].image_url.url,'data:image/jpeg;base64,AA');assert.match(body.messages[0].content,/Không dùng ngày kiểm định/);
 await assert.rejects(()=>c.read({type:'application/pdf',size:1000}),/Chọn ảnh/);
});
test('abort and account changes prevent late OCR results',async()=>{
 let controller=new AbortController();const aborted=aiContext(async()=>{controller.abort();return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(fields('Honda','CR-V','2024'))}}]})}});
 await assert.rejects(()=>aborted.read(photo,{signal:controller.signal}),{name:'AbortError'});
 const changed=aiContext(async()=>{changed.setOwner('other');return {ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(fields('Honda','CR-V','2024'))}}]})}});
 await assert.rejects(()=>changed.read(photo),/Tài khoản đã thay đổi/);
});
test('applying OCR replaces stale vehicle filters while preserving part query and item type',()=>{
 const a=html.indexOf('            function vehicleCatalog() {'),b=html.indexOf('            return { parse, search, vocabulary',a);assert.ok(a>0&&b>a);
 let applied,cleared=0;const ctx={catalog:()=>catalog.brands,parse:()=>null,NAM_ALL:catalog.years,selectedHieuList:['OLD MODEL'],selectedNamList:[2022],$:()=>({value:'Cản trước',dispatchEvent:()=>{}}),Event,window:{cancelLookupSearch:()=>cleared++,TascoAiSearch:{clearOffer:()=>{}}},hideAsk:()=>{},apply:r=>applied=r};vm.createContext(ctx);vm.runInContext(html.slice(a,b)+'\nthis.applyVehicle=applyVehicle;',ctx);
 assert.throws(()=>ctx.applyVehicle({brand:'HONDA',model:'made up',year:2024}));
 ctx.applyVehicle({brand:'HONDA',model:'CR-V',year:2024});
 assert.equal(applied.part,'Cản trước');assert.equal(applied.models[0],'CR-V');assert.equal(applied.years[0],2024);assert.equal(cleared,1);
 assert.equal(ctx.selectedHieuList.length,0);assert.equal(ctx.selectedNamList.length,0);
});
