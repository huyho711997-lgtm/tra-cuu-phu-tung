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

function fixture({rows = [], rpcError = null, fallbackError = null, status = 200, catalogYears = [2025]} = {}) {
    const calls = [];
    const query = {};
    for (const method of ['select', 'regexIMatch', 'in', 'order', 'limit']) {
        query[method] = (...args) => { calls.push([method, ...args]); return query; };
    }
    query.abortSignal = async () => ({data: rows, error: fallbackError});
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
    vm.runInContext(section('        window.TascoSmartSearch = (() => {','            function apply(r) {')+'return {parse};})();', context);
    vm.runInContext(section('        window.TascoPriceAssistant = (() => {','        function getPriceSignalBadge'), context);
    return {bridge: context.window.TascoPriceAssistant, calls};
}

test('câu hỏi HR-V tra đúng bộ lọc mà không yêu cầu đếm toàn bảng', async () => {
    const f = fixture({rows:[quote],catalogYears:[2024]});
    assert.ok(f.bridge.isPriceQuestion(question));
    const out = await f.bridge.search(question);
    assert.match(out,/1\.200\.000 VNĐ/);
    assert.match(out,/Chính hãng/);
    assert.equal(f.calls.length,1);
    const [,name,args] = f.calls[0];
    assert.equal(name,'tasco_search_parts_page_v4');
    assert.equal(args.p_keyword,'cản trước');
    assert.equal(args.p_hang,'HONDA');
    assert.deepEqual(Array.from(args.p_hieus),['HR-V']);
    assert.deepEqual(Array.from(args.p_nams),[2025]);
    assert.equal(args.p_include_total,false);
});

test('hàm tra cứu quá hạn thì đọc báo giá dự phòng với đúng phạm vi', async () => {
    const f = fixture({rows:[quote],rpcError:{code:'57014'},status:500});
    const out = await f.bridge.search('cản trước hrv 2025 chính hãng giá bao nhiêu');
    assert.match(out,/1\.200\.000 VNĐ/);
    assert.deepEqual(f.calls[1],['from','lich_su_bao_gia']);
    assert.ok(f.calls.some(([method,field,value])=>method==='regexIMatch' && field==='hieu_xe' && value.includes('(HR-V)')));
    assert.ok(f.calls.some(([method,field])=>method==='regexIMatch' && field==='chinh_hang'));
    assert.ok(f.calls.some(([method,field,values])=>method==='in' && field==='nam_sx' && values[0]===2025));
    assert.ok(f.calls.some(([method,size])=>method==='limit' && size===11));
});

test('phân biệt lỗi phiên, lỗi quyền và kết quả rỗng', async () => {
    const expired = fixture({rpcError:{code:'PGRST301'},status:401});
    await assert.rejects(()=>expired.bridge.search(question),/đăng nhập lại/);
    const denied = fixture({rpcError:{code:'42501'},status:403});
    await assert.rejects(()=>denied.bridge.search(question),/chưa có quyền/);
    assert.equal(denied.calls.length,1);
    const empty = fixture();
    assert.match(await empty.bridge.search(question),/Không tìm thấy báo giá/);
});

test('thiếu dòng xe thì hỏi lại và phân biệt tên phụ tùng giá đỡ', async () => {
    const f = fixture();
    assert.match(await f.bridge.search('giá cản trước Honda'),/hãng xe và dòng xe/);
    assert.equal(f.calls.length,0);
    assert.equal(f.bridge.isPriceQuestion('giá đỡ Honda CR-V'),false);
    assert.equal(f.bridge.isPriceQuestion('giá giá đỡ Honda CR-V'),true);
});
