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

const catalog = {HONDA: {'HR-V': {}, 'CR-V': {}}};
const quote = {ten_phu_tung:'Cản trước', hang_xe:'HONDA', hieu_xe:'HR-V', nam_sx:2025,
    gia_duyet:1200000, chinh_hang:'Chính hãng', ngay_bao_gia:'2026-10-15'};
const question = 'cản trước hrv 2025 giá bao nhiêu';

function fixture({rows = [], tableError = null, rpcError = null, status = 200, catalogYears = [2025]} = {}) {
    const calls = [];
    const query = {};
    for (const method of ['select', 'regexIMatch', 'eq', 'in', 'limit']) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    query.abortSignal = async () => ({data: rows, error: tableError, status});
    const context = vm.createContext({
        window: {TascoPartKind:{classify:value=>value === 'Chính hãng' ? 'genuine' : 'unknown'}},
        auth: {currentUser:{uid:'owner'}},
        CAY_GIA_PHA: catalog, NAM_ALL: catalogYears,
        supabase: {
            rpc(name,args) {
                calls.push(['rpc',name,args]);
                return {abortSignal: async () => ({data: {rows,total:null}, error: rpcError, status})};
            },
            from(table) { calls.push(['from',table]); return query; }
        }, AbortController, DOMException, setTimeout, clearTimeout, Intl
    });
    vm.runInContext(section('        window.parseDateForSort = function(value) {','        window.toggleExactPartName'), context);
    vm.runInContext(section('        window.TascoSmartSearch = (() => {','            function apply(r) {')+'return {parse};})();', context);
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
    assert.deepEqual(f.calls.find(([method])=>method==='regexIMatch'),['regexIMatch','ten_phu_tung','^[[:space:]]*cản[[:space:]]+trước[[:space:]]*$']);
    assert.deepEqual(f.calls.at(-1),['limit',11]);
    assert.ok(!f.calls.some(([method])=>method==='rpc'));
});

test('kho chưa có khóa chuẩn hóa thì dùng API cũ với đủ bộ lọc', async () => {
    const f = fixture({rows:[{...quote,ten_phu_tung:'Ốp đen cản trước'}],tableError:{code:'42703'},status:400});
    const out = await f.bridge.search('cản trước hrv 2025 chính hãng giá bao nhiêu');
    assert.match(out,/Không tìm thấy báo giá/);
    assert.doesNotMatch(out,/1\.200\.000 VNĐ/);
    const [,name,args] = f.calls.at(-1);
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
