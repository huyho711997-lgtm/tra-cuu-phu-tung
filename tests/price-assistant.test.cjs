const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync('mobile.html', 'utf8');
function section(start, end) {
    const a = html.indexOf(start), b = html.indexOf(end, a);
    assert.ok(a >= 0 && b > a);
    return html.slice(a, b);
}

const catalog = {HONDA: {'HR-V': {}, 'CR-V': {}},VINFAST: {'VF5 PLUS': {}, 'VF 3 PLUS': {}},HYUNDAI: {I10: {}}};
const quote = {ten_phu_tung:'Cản trước', hang_xe:'HONDA', hieu_xe:'HR-V', nam_sx:2025,
    gia_duyet:1200000, chinh_hang:'Chính hãng', ngay_bao_gia:'2026-10-15'};
const question = 'cản trước hrv 2025 giá bao nhiêu';

function fixture({rows = [], rowsWithoutYear = rows, rpcRows = () => rows, tableError = null, rpcError = null, status = 200, catalogYears = [2025]} = {}) {
    const calls = [];
    const query = {};
    let hasYear = false;
    for (const method of ['select', 'regexIMatch', 'eq', 'in', 'order', 'limit']) {
        query[method] = (...args) => {
            if(method==='select')hasYear=false;
            if(method==='in'&&args[0]==='nam_sx')hasYear=true;
            calls.push([method, ...args]);
            return query;
        };
    }
    query.abortSignal = async () => ({data: hasYear?rows:rowsWithoutYear, error: tableError, status});
    const context = vm.createContext({
        window: {TascoPartKind:{classify:value=>value === 'Chính hãng' ? 'genuine' : 'unknown'}},
        auth: {currentUser:{uid:'owner'}},
        CAY_GIA_PHA: catalog, NAM_ALL: catalogYears,
        supabase: {
            rpc(name,args) {
                calls.push(['rpc',name,args]);
                return {abortSignal: async () => ({data: {rows:rpcRows(args),total:null}, error: rpcError, status})};
            },
            from(table) { calls.push(['from',table]); return query; }
        }, AbortController, AbortSignal, DOMException, setTimeout, clearTimeout, Intl
    });
    vm.runInContext(section('        window.parseDateForSort = function(value) {','        window.toggleExactPartName'), context);
    const parser = section('        window.TascoSmartSearch = (() => {','            function apply(r) {');
    const ground = section('            function ground(ai, local, cat) {','            function describe(r)');
    vm.runInContext(parser+ground+'return {parse,ground,vehicleCatalog:()=>({brands:catalog()||[]})};})();', context);
    vm.runInContext(section('        window.TascoPriceAssistant = (() => {','        function getPriceSignalBadge'), context);
    return {bridge: context.window.TascoPriceAssistant, calls};
}

test('câu hỏi giá cản trước HR-V chỉ hiển thị đúng tên phụ tùng', async () => {
    const f = fixture({
        rows:[
            {...quote,ten_phu_tung:'Ốp bạc cản trước',gia_duyet:3214000},
            {...quote,ten_phu_tung:'Ốp đen cản trước',gia_duyet:2612000},
            {...quote,ten_phu_tung:'Cản trước dưới',gia_duyet:1820000},
            {...quote,ten_phu_tung:' CẢN   TRƯỚC '}
        ],
        catalogYears:[2024]
    });
    assert.ok(f.bridge.isPriceQuestion(question));
    const out = await f.bridge.search(question);
    assert.match(out,/1\.200\.000 VNĐ/);
    assert.match(out,/Chính hãng/);
    assert.match(out,/Tìm thấy 1 báo giá/);
    assert.doesNotMatch(out,/Ốp bạc|Ốp đen|Cản trước dưới/);
    assert.deepEqual(f.calls[0],['from','lich_su_bao_gia']);
    assert.deepEqual(f.calls.find(([method])=>method==='eq'),['eq','_kgpt_ai_brand_key','HONDA']);
    assert.deepEqual(Array.from(f.calls.find(([,field])=>field==='_kgpt_ai_model_key')[2]),['HR-V']);
    assert.deepEqual(Array.from(f.calls.find(([,field])=>field==='nam_sx')[2]),[2025]);
    const [,column,pattern]=f.calls.find(([method])=>method==='regexIMatch');
    assert.equal(column,'ten_phu_tung');
    const matches=new RegExp(pattern.replaceAll('[[:space:]]','\\s'),'iu');
    assert.ok(matches.test('Cụm cản trước'));
    assert.ok(!matches.test('Ốp bạc cản trước'));
    assert.deepEqual(f.calls.at(-1),['limit',11]);
    assert.ok(!f.calls.some(([method])=>method==='rpc'));
});

test('kho chưa có khóa chuẩn hóa thì dùng API cũ với đủ bộ lọc', async () => {
    const f = fixture({rows:[{...quote,ten_phu_tung:'Ốp đen cản trước'}],tableError:{code:'42703'},status:400});
    const out = await f.bridge.search('cản trước hrv 2025 chính hãng giá bao nhiêu');
    assert.match(out,/Không tìm thấy báo giá/);
    assert.doesNotMatch(out,/1\.200\.000 VNĐ/);
    const [,name,args] = f.calls.find(([method,,args])=>method==='rpc'&&args.p_exact);
    assert.equal(name,'tasco_search_parts_page_v4');
    assert.equal(args.p_kind,'genuine');
    assert.equal(args.p_exact,true);
    assert.deepEqual(Array.from(args.p_hieus),['HR-V']);
    assert.deepEqual(Array.from(args.p_nams),[2025]);
    assert.equal(args.p_include_total,false);
});

test('phân biệt lỗi phiên, lỗi quyền và kết quả rỗng', async () => {
    const expired = fixture({tableError:{code:'PGRST301'},status:401});
    await assert.rejects(()=>expired.bridge.search(question),/đăng nhập lại/);
    const denied = fixture({tableError:{code:'42501'},status:403});
    await assert.rejects(()=>denied.bridge.search(question),/chưa có quyền/);
    assert.ok(!denied.calls.some(([method])=>method==='rpc'));
    const empty = fixture();
    assert.match(await empty.bridge.search(question),/Không tìm thấy báo giá/);
});

test('ngày báo giá hiển thị ngày/tháng/năm đúng với ngày trong kho', async () => {
    const f = fixture({rows:[
        {...quote,ngay_bao_gia:'2026-08-24T00:00:00+00:00'},
        {...quote,ngay_bao_gia:'2025-10-19'},
        {...quote,ngay_bao_gia:'6/1/2026'},
        {...quote,ngay_bao_gia:null}
    ]});
    const out = await f.bridge.search(question);
    assert.match(out,/Ngày báo giá: 24\/08\/2026/);
    assert.match(out,/Ngày báo giá: 19\/10\/2025/);
    assert.match(out,/Ngày báo giá: 06\/01\/2026/);
    assert.doesNotMatch(out,/T00:00:00/);
    assert.equal((out.match(/Ngày báo giá:/g)||[]).length,3);
});

test('thiếu dòng xe thì hỏi lại và phân biệt tên phụ tùng giá đỡ', async () => {
    const f = fixture();
    assert.match(await f.bridge.search('giá cản trước Honda'),/hãng xe và dòng xe/);
    assert.equal(f.calls.length,0);
    assert.equal(f.bridge.isPriceQuestion('giá đỡ Honda CR-V'),false);
    assert.equal(f.bridge.isPriceQuestion('giá giá đỡ Honda CR-V'),true);
});

test('báo giá tự động tách hạng mục và mở rộng đèn pha bên trái, phải', async () => {
    const f=fixture({rows:[
        {...quote,ten_phu_tung:'Cản trước',hieu_xe:'VF5 PLUS'},
        {...quote,ten_phu_tung:'Đèn pha trái',hieu_xe:'VF5 PLUS',gia_duyet:800000},
        {...quote,ten_phu_tung:'Đèn pha bên phải',hieu_xe:'VF5 PLUS',gia_duyet:900000},
        {...quote,ten_phu_tung:'Ốp đèn pha bên phải',hieu_xe:'VF5 PLUS',gia_duyet:50000}
    ]});
    const out=await f.bridge.search('Báo giá cho tôi cản trước, đèn pha bên trái, phải, két nước, VinFast VF5 Plus 2025.');
    assert.match(out,/^\*\*Bảng báo giá nhanh\*\*/);
    assert.match(out,/VINFAST · VF5 Plus · 2025/);
    assert.match(out,/\| cản trước \| 1\.200\.000 \|/);
    assert.match(out,/\| đèn pha bên trái \| 800\.000 \|/);
    assert.match(out,/\| đèn pha phải \| 900\.000 \|/);
    assert.match(out,/\| két nước \| Chưa có giá \|/);
    assert.match(out,/Tạm tính 3\/4 hạng mục.*2\.900\.000 VNĐ/);
    assert.equal(f.calls.filter(([method])=>method==='from').length,4);
    assert.doesNotMatch(out,/Ốp đèn pha/);
});

test('nhận diện lỗi chính tả cảng trước với Hyundai i10 đời 2014', async () => {
    const f=fixture({rows:[{...quote,hang_xe:'HYUNDAI',hieu_xe:'I10',nam_sx:2014}]});
    const out=await f.bridge.search('Cảng trước Hyundai i10 2014 bao nhiêu tiền?');
    assert.match(out,/Cản trước — 1\.200\.000 VNĐ/);
    assert.deepEqual(Array.from(f.calls.find(([,field])=>field==='nam_sx')[2]),[2014]);
});

test('năm yêu cầu thiếu báo giá thì chỉ gợi ý đời khác, không gán nhầm giá', async () => {
    const f=fixture({rowsWithoutYear:[
        {...quote,hang_xe:'HYUNDAI',hieu_xe:'I10',nam_sx:2019},
        {...quote,hang_xe:'HYUNDAI',hieu_xe:'I10',nam_sx:2020}
    ]});
    const out=await f.bridge.search('Cảng trước Hyundai i10 2014 bao nhiêu tiền?');
    assert.match(out,/Không tìm thấy báo giá.*2014/);
    assert.match(out,/đời khác như 2019, 2020/);
    assert.doesNotMatch(out,/1\.200\.000 VNĐ/);
});

test('bảng báo giá hỗ trợ danh sách xuống dòng và yêu cầu một năm sản xuất', async () => {
    const f=fixture({rows:[quote]});
    const prompt='Làm cho tôi 1 bảng báo giá nhanh Honda HR-V';
    assert.match(await f.bridge.search(prompt+'\n- Cản trước\n- Đèn pha trái'),/một năm sản xuất/);
    const out=await f.bridge.search(prompt+' 2025:\n1. Cản trước\n2. Đèn pha trái');
    assert.match(out,/\| Cản trước \| 1\.200\.000 \|/);
    assert.match(out,/\| Đèn pha trái \| Chưa có giá \|/);
});

test('VF3 without a brand uses the VinFast warehouse entry and understands a short year', async () => {
    const f = fixture({rows: [{...quote, hang_xe:'VINFAST', hieu_xe:'VF 3 PLUS'}]});
    const request = 'can truoc vf-3 doi 25 gia bao nhieu';
    assert.equal(f.bridge.isPriceQuestion(request), true);
    assert.match(await f.bridge.search(request), /1\.200\.000 VNĐ/);
    assert.ok(f.calls.some(([method,key,value])=>method==='eq'&&key==='_kgpt_ai_brand_key'&&value==='VINFAST'));
    assert.ok(f.calls.some(([method,key,value])=>method==='in'&&key==='_kgpt_ai_model_key'&&value.join() === 'VF 3 PLUS'));
    assert.ok(f.calls.some(([method,key,value])=>method==='in'&&key==='nam_sx'&&value.join() === '2025'));
});

test('a warehouse follow-up keeps the vehicle and changes the requested side', async () => {
    const f = fixture({rows: [{...quote, ten_phu_tung:'Đèn pha bên phải'}]});
    let previous;
    await f.bridge.search('giá đèn pha trái HR-V đời 25', undefined, undefined, value=>{previous=value;});
    const request = 'Còn bên phải thì sao?';
    assert.equal(f.bridge.isPriceQuestion(request, previous), true);
    assert.match(await f.bridge.search(request, undefined, previous), /Đèn pha bên phải — 1\.200\.000 VNĐ/);
    assert.equal(f.bridge.isPriceQuestion('Còn thời tiết thì sao?', previous), false);
});

test('a recognized VF model missing from the catalog does not query other vehicles', async () => {
    const f = fixture({rows: [quote]});
    assert.match(await f.bridge.search('giá cản trước vf 9'), /VinFast VF9.*danh mục/);
    assert.deepEqual(f.calls, []);
});

test('short VF3 query and bare side follow-up both search the warehouse', async () => {
    const left={...quote,ten_phu_tung:'Đèn pha trái',hang_xe:'VINFAST',hieu_xe:'VF 3 PLUS',gia_duyet:2541000};
    const right={...left,ten_phu_tung:'Đèn pha phải',gia_duyet:2700000};
    const trim={...left,ten_phu_tung:'Ốp đèn pha trái',gia_duyet:999000};
    const f=fixture({rpcRows:args=>args.p_exact?[]:[left,right,trim]});
    const question='Đèn pha VF3 2025';
    assert.equal(f.bridge.isPriceQuestion(question),true);
    assert.equal(f.bridge.isPriceQuestion('Cách thay đèn pha VF3 2025'),false);
    let previous;
    const both=await f.bridge.search(question,undefined,undefined,value=>{previous=value;});
    assert.match(both,/Đèn pha trái — 2\.541\.000 VNĐ/);
    assert.match(both,/Đèn pha phải — 2\.700\.000 VNĐ/);
    assert.doesNotMatch(both,/999\.000/);
    for(const context of [previous,f.bridge.contextFromQuestion(question)]){
        assert.equal(f.bridge.isPriceQuestion('Đèn pha trái',context),true);
        const single=await f.bridge.search('Đèn pha trái',undefined,context);
        assert.match(single,/Đèn pha trái — 2\.541\.000 VNĐ/);
        assert.doesNotMatch(single,/Đèn pha phải|999\.000/);
    }
    const calls=f.calls.filter(([method,,args])=>method==='rpc'&&!args.p_exact);
    assert.ok(calls.length);
    for(const [,,args] of calls){
        assert.equal(args.p_hang,'VINFAST');
        assert.equal(args.p_hieus.join(),'VF 3 PLUS');
        assert.equal(args.p_nams.join(),'2025');
    }
});

test('semantic plan routes a paraphrase with no supported keyword, using context and only warehouse prices', async () => {
    const row={...quote,ten_phu_tung:'Gương chiếu hậu trái',hang_xe:'HYUNDAI',hieu_xe:'I10',gia_duyet:1870000};
    const f=fixture({rows:[row,{...row,ten_phu_tung:'Kính chiếu hậu phải',gia_duyet:999000}]});
    const question='Cái để nhìn phía sau ở phía tài xế của con đó thì bao nhiêu?';
    const previous={owner:'owner',brand:'HYUNDAI',models:['I10'],years:[2025],part:'Đèn hậu trái',kind:'all'};
    assert.equal(f.bridge.isPriceQuestion(question,previous),false);
    const intent=await f.bridge.plan(question,[{role:'user',text:'Đèn hậu i10 2025'}],previous,async request=>{
        const input=JSON.parse(request.contents[0].parts[0].text);
        assert.equal(input.question,question);
        assert.equal(input.vehicle.models[0],'I10');
        return JSON.stringify({route:'warehouse',brand:'Hyundai',model:'i10',years:[2025],kind:'all',
            items:[{name:'Kính chiếu hậu trái',aliases:['Gương chiếu hậu trái','Kính chiếu hậu phải'],price:5000}]});
    });
    const out=await f.bridge.search(question,undefined,previous,undefined,intent);
    assert.match(out,/Gương chiếu hậu trái — 1\.870\.000 VNĐ/);
    assert.doesNotMatch(out,/999\.000|5\.000 VNĐ/);
    assert.equal(await f.bridge.plan('Cách tháo đèn hậu i10?',[],previous,async()=> '{"route":"other"}'),null);
});

test('a warehouse statement timeout tries the lookup RPC with the same i10 and year', async () => {
    const row={...quote,ten_phu_tung:'Đèn hậu trái',hang_xe:'HYUNDAI',hieu_xe:'I10'};
    const f=fixture({tableError:{code:'57014'},status:504,rpcRows:()=>[row]});
    const out=await f.bridge.search('Đèn hậu i10 2025');
    assert.match(out,/Đèn hậu trái — 1\.200\.000 VNĐ/);
    const calls=f.calls.filter(([method])=>method==='rpc');
    assert.equal(calls.length,1);
    assert.equal(calls[0][2].p_hieus.join(),'I10');
    assert.equal(calls[0][2].p_nams.join(),'2025');
});

test('audio analysis returns a warehouse plan alongside the transcript in one model call', async () => {
    const item={...quote,hang_xe:'HYUNDAI',hieu_xe:'I10',ten_phu_tung:'Đèn hậu trái'};
    const f=fixture({rows:[item]});
    let requests=0;
    const spoken=await f.bridge.plan('',[],null,async request=>{
        requests++;
        assert.match(request.system_instruction.parts[0].text,/Nghe trực tiếp audio/);
        return JSON.stringify({route:'warehouse',transcript:'Đèn hậu trái i10 đời 25',
            brand:'HYUNDAI',model:'I10',years:[2025],items:[{name:'Đèn hậu trái'}]});
    },undefined,{audio:true});
    assert.equal(spoken.question,'Đèn hậu trái i10 đời 25');
    assert.equal(spoken.intent.brand,'HYUNDAI');
    const result=await f.bridge.search(spoken.question,undefined,null,undefined,spoken.intent);
    assert.match(result,/Đèn hậu trái — 1\.200\.000 VNĐ/);
    assert.equal(requests,1);
    const other=await f.bridge.plan('',[],null,async()=> '{"route":"other","transcript":"Cảm ơn bạn"}',
        undefined,{audio:true});
    assert.equal(other.question,'Cảm ơn bạn');
    assert.equal(other.intent,null);
});

test('editable repair quote keeps stock prices, multiplies quantities and excludes missing rates', async () => {
    const f=fixture({rows:[quote]});
    const prompt='Báo giá 2 cản trước và 1 đèn pha trái Honda HR-V 2025';
    const intent=await f.bridge.plan(prompt,[],null,async()=>JSON.stringify({route:'warehouse',brand:'HONDA',
        model:'HR-V',years:[2025],quick:true,items:[{name:'Cản trước',quantity:2},{name:'Đèn pha trái',quantity:1}]}));
    let saved;
    await f.bridge.search(prompt,undefined,null,undefined,intent,data=>{saved=data;});
    const ctx=vm.createContext({Intl,window:{TascoPriceAssistant:f.bridge}});
    vm.runInContext(section('  const quoteMoney=new Intl.NumberFormat','  function quoteSummaryHtml(quote){')
        +'this.rows=quoteSheetRows;this.summary=quoteSummary;this.migrate=businessQuote;',ctx);
    assert.equal(ctx.summary(saved).total,2400000);
    assert.equal(ctx.summary(saved).pending,3);
    saved.lines[0].proposed=1100000;
    saved.lines[2].proposed=800000;
    saved.lines[3].quantity=1.5;
    saved.lines[3].proposed=300000;
    assert.equal(ctx.summary(saved).total,3450000);
    assert.equal(ctx.summary(saved).pending,1);
    const rows=ctx.rows(saved);
    assert.deepEqual(Array.from(rows[4].slice(2,6)),[2,1200000,1100000,2200000]);
    assert.equal(rows[5][5],null);
    assert.equal(rows.find(row=>row[0]==='Tổng tạm tính (VNĐ)')[5],3450000);
    const legacy={role:'assistant',priceLookup:true,text:'**Bảng báo giá nhanh**\nHONDA · HR-V · 2025\n\n| Tên | Giá | Nguồn |\n| --- | --- | --- |\n| Cản trước | 1.200.000 | Chính hãng |\n\nTạm tính'};
    assert.equal(ctx.migrate(legacy).lines[0].stock,1200000);
    assert.equal(ctx.migrate(legacy).lines.length,3);
});

test('phone quote cards use a sourced paint estimate only after applying the selected rate', () => {
    const f=fixture(),context=vm.createContext({Intl,esc:String});
    vm.runInContext(section('  const quoteMoney=new Intl.NumberFormat','  function quoteMessage(element){')
        +'this.applyRate=applyPaintRate;this.render=editableQuoteHtml;this.rows=quoteSheetRows;',context);
    const quote=f.bridge.withServiceEstimate('VINFAST · VF5 · 2025',[]);
    const paint=quote.lines[0];
    paint.paintId='bumper';
    assert.equal(paint.proposed,null);
    const cards=context.render(quote,'');
    assert.doesNotMatch(cards,/<table|Vuốt ngang/);
    assert.match(cards,/800\.000–1\.300\.000 VNĐ/);
    assert.match(cards,/https:\/\/1cargara\.vn\//);
    assert.ok(context.applyRate(paint));
    paint.quantity=2;
    const row=context.rows(quote)[4];
    assert.equal(row[4],1050000);
    assert.equal(row[5],2100000);
    assert.match(row[6],/kiểm tra 26\/11\/2026/);
    assert.match(row[6],/https:\/\/gtxautocare\.vn\//);
});
