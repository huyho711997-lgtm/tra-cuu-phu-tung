/* OCR đăng kiểm: kết quả chỉ được đưa vào bộ lọc sau khi người dùng xác nhận. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.TascoRegistrationOCR=api;
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const text=v=>typeof v==='string'||typeof v==='number'?String(v).replace(/[\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,120):'';
  const key=v=>text(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[đĐ]/g,'d').toLowerCase().replace(/[^a-z0-9]/g,'');
  function normalizeResponse(raw){
    if(typeof raw!=='string')throw new Error('Kết quả OCR không hợp lệ.');
    const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
    if(start<0||end<start)throw new Error('Kết quả OCR không có dữ liệu xe.');
    const data=JSON.parse(raw.slice(start,end+1));
    if(!data||Array.isArray(data)||typeof data!=='object')throw new Error('Kết quả OCR không hợp lệ.');
    const fields={};
    for(const name of ['brand','model','year']){
      const item=data[name],object=item&&typeof item==='object';
      let value=text(object?item.value:item);if(/^(null|undefined|unknown|n\/a)$/i.test(value))value='';
      if(name==='year'&&!/^(19|20)\d{2}$/.test(value))value='';
      const confidence=Number(object?item.confidence:0);
      fields[name]={value,confidence:Number.isFinite(confidence)?Math.max(0,Math.min(1,confidence)):0};
    }
    return fields;
  }
  function normalizeSuggestions(raw,models){
    if(typeof raw!=='string')throw new Error('Kết quả AI không hợp lệ.');
    const start=raw.indexOf('{'),end=raw.lastIndexOf('}');
    if(start<0||end<start)throw new Error('Kết quả AI không hợp lệ.');
    const data=JSON.parse(raw.slice(start,end+1));
    if(!Array.isArray(data.suggestions))throw new Error('Kết quả AI không hợp lệ.');
    const found=[],seen=new Set();
    for(const item of data.suggestions){const index=item?.index;if(!Number.isInteger(index)||index<0||index>=models.length||seen.has(index))continue;seen.add(index);found.push({model:models[index],reason:text(item.reason)});if(found.length===5)break;}
    return found;
  }
  function matchVehicle(fields,catalog){
    const brands=catalog.brands||[],brandKey=key(fields.brand?.value),modelKey=key(fields.model?.value);
    const aliases={mercedes:'mercedesbenz',merc:'mercedesbenz',chevy:'chevrolet',huyndai:'hyundai'};
    const canonical=v=>aliases[v]||v;
    const found=brands.filter(b=>brandKey&&canonical(key(b.name))===canonical(brandKey));
    const brand=found.length===1?found[0]:null;
    const models=brand?(brand.models||[]):[];
    let candidates=models.filter(m=>modelKey&&key(m)===modelKey);
    if(!candidates.length&&modelKey.length>=3){
      candidates=models.filter(m=>{
        const mk=key(m),words=text(m).split(/\s+/);
        // Chỉ khớp tiền tố theo từ trọn vẹn: Vios → Vios E/G, không Vios → Vioss.
        return words.some((_,i)=>key(words.slice(0,i+1).join(' '))===modelKey)||
          text(fields.model?.value).split(/\s+/).some((_,i,a)=>key(a.slice(0,i+1).join(' '))===mk);
      });
    }
    const year=Number(fields.year?.value);
    return {brand:brand?.name||'',model:candidates.length===1?candidates[0]:'',candidates,year:(catalog.years||[]).includes(year)?String(year):''};
  }
  const icon=paths=>'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+paths+'</svg>';
  const I={close:icon('<path d="m6 6 12 12M18 6 6 18"/>'),scan:icon('<path d="M8 3H5a2 2 0 0 0-2 2v3m13-5h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3m8 0h3a2 2 0 0 0 2-2v-3M7 8h10M7 12h7M7 16h9"/>'),camera:icon('<path d="m8 5 1-2h6l1 2h4a1 1 0 0 1 1 1v13H3V6a1 1 0 0 1 1-1z"/><circle cx="12" cy="12" r="4"/>'),photo:icon('<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1"/><path d="m3 17 5-5 4 4 4-6 5 7"/>'),check:icon('<path d="m5 12 4 4L19 6"/>')};
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let session=null,accountId=null;
  function open(){
    if(session)return;
    const catalog=window.TascoSmartSearch?.vehicleCatalog?.();
    if(!catalog?.brands.length){window.customAlert?.('Danh mục xe chưa tải xong. Hãy chờ tải dữ liệu rồi thử lại.');return;}
    const opener=document.activeElement,box=document.createElement('div');
    box.className='reg-ocr-overlay';
    box.innerHTML='<section class="reg-ocr-sheet" role="dialog" aria-modal="true" aria-labelledby="regOcrTitle" aria-describedby="regOcrDesc" tabindex="-1"><header class="reg-ocr-head"><span class="reg-ocr-emblem">'+I.scan+'</span><div><h2 id="regOcrTitle">Quét đăng kiểm</h2><p id="regOcrDesc">Nhận diện thông tin xe từ giấy đăng kiểm</p></div><button type="button" class="reg-ocr-close" data-reg="close" aria-label="Đóng OCR đăng kiểm">'+I.close+'</button></header><div class="reg-ocr-content"><div class="reg-ocr-preview" data-preview><span>'+I.scan+'</span><strong>Chụp rõ phần thông tin phương tiện</strong><p>Đủ nhãn hiệu, số loại và năm sản xuất.<br>Ảnh chỉ dùng để đọc, không lưu vào hồ sơ.</p></div><div class="reg-ocr-pickers"><button type="button" data-reg="camera">'+I.camera+'Chụp đăng kiểm</button><button type="button" data-reg="photo">'+I.photo+'Chọn ảnh</button></div><input type="file" accept="image/*" capture="environment" data-file="camera" hidden><input type="file" accept="image/*" data-file="photo" hidden><p class="reg-ocr-status" role="status" aria-live="polite" data-status>Hỗ trợ ảnh JPG, PNG, WebP · tối đa 20 MB</p><button type="button" class="reg-ocr-read" data-reg="read" hidden>'+I.scan+'Đọc thông tin xe</button><form class="reg-ocr-review" data-review hidden><div class="reg-ocr-review-heading"><span>'+I.check+'</span><div><h3>Kiểm tra thông tin</h3><p>Đối chiếu với giấy đăng kiểm trước khi áp dụng</p></div></div><div class="reg-ocr-field"><label for="regOcrBrand">Hãng xe</label><select id="regOcrBrand" required></select><small data-raw="brand"></small></div><div class="reg-ocr-field"><label for="regOcrModel">Hiệu / dòng xe</label><select id="regOcrModel" required></select><small data-raw="model"></small></div><div class="reg-ocr-field"><label for="regOcrYear">Năm sản xuất</label><select id="regOcrYear" required></select><small data-raw="year"></small></div><p class="reg-ocr-engine" data-engine></p><button type="submit" class="reg-ocr-apply">'+I.check+'Điền vào bộ lọc tra cứu</button></form><p class="reg-ocr-error" role="alert" data-error hidden></p><button type="button" class="reg-ocr-settings" data-reg="settings" hidden>Cài đặt mô hình AI</button></div></section>';
    box.querySelector('#regOcrModel').required=false;
    box.querySelector('[data-raw="model"]').insertAdjacentHTML('afterend','<div class="reg-model-ai"><div data-selected-models aria-label="Dòng xe đã chọn"></div><div data-suggest-status role="status" aria-live="polite"></div><div data-suggestions></div><button type="button" data-reg="suggest" hidden>Thử tìm lại hiệu xe tương tự</button></div>');
    const oldOverflow=document.body.style.overflow;
    const s=session={box,opener,oldOverflow,catalog,file:null,url:'',result:null,controller:null,revision:0,suggestCtl:null,suggestRevision:0,selected:new Set()};
    document.body.append(box);document.body.style.overflow='hidden';
    const q=selector=>box.querySelector(selector),status=q('[data-status]'),error=q('[data-error]'),read=q('[data-reg="read"]'),review=q('[data-review]');
    function options(node,items,value,placeholder){node.innerHTML='<option value="">'+esc(placeholder)+'</option>'+items.map(v=>'<option value="'+esc(v)+'">'+esc(v)+'</option>').join('');node.value=value||'';}
    function models(value=''){
      const brand=s.catalog.brands.find(b=>b.name===q('#regOcrBrand').value);
      options(q('#regOcrModel'),brand?.models||[],'','Thêm dòng xe');q('#regOcrModel').disabled=!brand;
      if(value)s.selected.add(value);renderSelected();
    }
    function renderSelected(){
      const target=q('[data-selected-models]');target.replaceChildren();
      for(const name of s.selected){const btn=document.createElement('button');btn.type='button';btn.className='reg-selected-model';btn.textContent=name+' ×';btn.setAttribute('aria-label','Bỏ dòng xe '+name);btn.addEventListener('click',()=>{s.selected.delete(name);renderSelected();});target.append(btn);}
      q('[data-suggestions]').querySelectorAll('[data-model]').forEach(btn=>btn.setAttribute('aria-pressed',String(s.selected.has(btn.dataset.model))));
    }
    function clearSuggestions(){s.suggestRevision++;s.suggestCtl?.abort();s.suggestCtl=null;q('[data-suggestions]').replaceChildren();q('[data-suggest-status]').textContent='';q('[data-reg="suggest"]').disabled=false;}
    async function suggest(){
      const brand=q('#regOcrBrand').value,source=s.result?.fields.model.value,entry=s.catalog.brands.find(b=>b.name===brand);
      if(!brand||!entry){q('[data-suggest-status]').textContent='Hãy chọn hãng xe trước.';return;}
      if(!source){q('[data-suggest-status]').textContent='Chưa đọc được hiệu xe trên giấy. Hãy chọn dòng xe thủ công.';return;}
      clearSuggestions();const ctl=s.suggestCtl=new AbortController(),revision=++s.suggestRevision,button=q('[data-reg="suggest"]');
      button.disabled=true;button.hidden=true;q('[data-suggest-status]').textContent='AI đang đối chiếu các dòng xe tương tự…';
      try{
        if(!window.TascoAsk?.suggestInspectionModels)throw new Error('Chưa tải xong AI. Hãy thử lại.');
        const list=await window.TascoAsk.suggestInspectionModels({brand,model:source,models:entry.models},{signal:ctl.signal});
        if(session!==s||revision!==s.suggestRevision||ctl.signal.aborted)return;
        q('[data-suggest-status]').textContent=list.length?'Chọn một hoặc nhiều dòng xe phù hợp:':'Chưa tìm thấy hiệu xe tương tự. Bạn có thể chọn thủ công.';
        const target=q('[data-suggestions]');
        for(const item of list){const btn=document.createElement('button');btn.type='button';btn.className='reg-model-suggestion';btn.dataset.model=item.model;const title=document.createElement('strong');title.textContent=item.model;const reason=document.createElement('small');reason.textContent=item.reason||'Xem và đối chiếu';btn.append(title,reason);btn.addEventListener('click',()=>{if(s.selected.has(item.model))s.selected.delete(item.model);else if(s.selected.size<30)s.selected.add(item.model);else{q('[data-suggest-status]').textContent='Chọn tối đa 30 dòng xe.';return;}renderSelected();});target.append(btn);}renderSelected();
      }catch(err){if(session===s&&revision===s.suggestRevision&&!ctl.signal.aborted){q('[data-suggest-status]').textContent=err.message||'Chưa phân tích được. Hãy chọn thủ công.';button.hidden=false;}}
      finally{if(session===s&&revision===s.suggestRevision){s.suggestCtl=null;button.disabled=false;}}
    }
    function showError(message){error.textContent=message;error.hidden=false;}
    function busy(on){
      q('.reg-ocr-sheet').setAttribute('aria-busy',String(on));
      box.querySelectorAll('.reg-ocr-pickers button').forEach(b=>b.disabled=on);
      read.hidden=!s.file||!!s.result;read.innerHTML=on?'<span class="reg-ocr-spinner" aria-hidden="true"></span>Đang đọc… <span class="reg-ocr-stop">Hủy</span>':I.scan+'Đọc thông tin xe';
    }
    function renderResult(){
      q('.reg-ocr-sheet').classList.add('is-reviewed');
      const matched=matchVehicle(s.result.fields,s.catalog);
      options(q('#regOcrBrand'),s.catalog.brands.map(b=>b.name),matched.brand,'Chọn hãng xe');models(matched.model);
      options(q('#regOcrYear'),s.catalog.years.map(String),matched.year,'Chọn năm sản xuất');
      for(const name of ['brand','model','year']){
        const field=s.result.fields[name],el=q('[data-raw="'+name+'"]');
        el.textContent=field.value?'Trên giấy: '+field.value+(field.confidence<.7?' · cần kiểm tra kỹ':''):'Chưa đọc rõ trên ảnh · vui lòng chọn lại';
        el.classList.toggle('is-uncertain',!field.value||field.confidence<.7);
      }
      if(matched.candidates.length>1)q('[data-raw="model"]').textContent+=' · Có nhiều phiên bản, hãy chọn đúng dòng xe';
      if(s.result.fields.year.value&&!matched.year)q('[data-raw="year"]').textContent+=' · Năm này chưa có trong danh mục';
      q('[data-engine]').textContent=s.result.engine||'';review.hidden=false;read.hidden=true;
      status.textContent='Đã đọc ảnh. Bạn có thể chỉnh các lựa chọn bên dưới.';
    }
    async function analyze(){
      if(s.controller){s.revision++;s.controller.abort();s.controller=null;busy(false);status.textContent='Đã hủy đọc ảnh. Bạn có thể thử lại.';return;}
      if(!s.file)return;
      const ctl=s.controller=new AbortController(),revision=++s.revision;error.hidden=true;q('[data-reg="settings"]').hidden=true;busy(true);status.textContent='AI đang đọc nhãn hiệu, số loại và năm sản xuất…';
      try{
        if(!window.TascoAsk?.readInspection)throw new Error('Chưa tải xong AI đọc ảnh. Hãy thử lại sau ít giây.');
        const result=await window.TascoAsk.readInspection(s.file,{signal:ctl.signal});
        if(session!==s||s.revision!==revision||ctl.signal.aborted)return;
        s.result=result;renderResult();if(q('#regOcrBrand').value&&result.fields.model.value)suggest();
      }catch(e){
        if(session!==s||s.revision!==revision||ctl.signal.aborted)return;
        showError(e.message||'Chưa đọc được ảnh. Hãy chụp lại và thử lại.');status.textContent='Bạn có thể chọn ảnh khác hoặc thử đọc lại.';q('[data-reg="settings"]').hidden=false;
      }finally{if(session===s&&s.revision===revision){s.controller=null;busy(false);}}
    }
    box.addEventListener('click',e=>{
      const action=e.target.closest('[data-reg]')?.dataset.reg;
      if(e.target===box||action==='close')close();
      else if(action==='camera'||action==='photo')q('[data-file="'+action+'"]').click();
      else if(action==='read')analyze();
      else if(action==='suggest')suggest();
      else if(action==='settings'){close();window.updateView?.('ask');}
    });
    box.addEventListener('change',e=>{
      if(e.target.id==='regOcrBrand'){clearSuggestions();s.selected.clear();models();if(s.result&&e.target.value)suggest();return;}
      if(e.target.id==='regOcrModel'){if(e.target.value){if(s.selected.size<30)s.selected.add(e.target.value);else q('[data-suggest-status]').textContent='Chọn tối đa 30 dòng xe.';e.target.value='';renderSelected();}return;}
      if(!e.target.matches('[data-file]'))return;
      const file=e.target.files?.[0];e.target.value='';if(!file)return;
      error.hidden=true;
      if(!/^image\//i.test(file.type)||file.size>20*1024*1024){showError('Chọn ảnh đăng kiểm dưới 20 MB (JPG, PNG hoặc WebP).');return;}
      clearSuggestions();s.selected.clear();renderSelected();s.revision++;s.controller?.abort();s.controller=null;busy(false);
      if(s.url)URL.revokeObjectURL(s.url);
      q('.reg-ocr-sheet').classList.remove('is-reviewed');
      s.file=file;s.url=URL.createObjectURL(file);s.result=null;review.hidden=true;read.hidden=false;q('[data-reg="settings"]').hidden=true;
      q('[data-preview]').innerHTML='<img src="'+esc(s.url)+'" alt="Ảnh đăng kiểm đã chọn"><span class="reg-ocr-file-name">'+esc(file.name)+'</span>';
      status.textContent='Ảnh đã sẵn sàng. Chạm Đọc thông tin xe để bắt đầu.';
    });
    review.addEventListener('submit',e=>{
      e.preventDefault();error.hidden=true;
      try{
        window.TascoSmartSearch.applyVehicle({brand:q('#regOcrBrand').value,models:[...s.selected],year:q('#regOcrYear').value});
        close();const note=document.getElementById('aiPartNote');if(note){note.textContent='Đã điền thông tin xe từ đăng kiểm. Nhập tên phụ tùng rồi bấm Tra cứu.';note.hidden=false;}
        document.getElementById('searchInput')?.focus();
      }catch(err){showError(err.message);}
    });
    s.keydown=e=>{
      if(e.key==='Escape'){e.preventDefault();close();return;}
      if(e.key!=='Tab')return;
      const nodes=[...box.querySelectorAll('button:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(n=>!n.hidden&&n.getClientRects().length);
      const first=nodes[0],last=nodes[nodes.length-1];
      if(e.shiftKey&&(document.activeElement===first||!box.contains(document.activeElement))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',s.keydown);q('[data-reg="close"]').focus();
  }
  function close(){
    const s=session;if(!s)return;session=null;s.revision++;s.suggestRevision++;s.suggestCtl?.abort();s.controller?.abort();if(s.url)URL.revokeObjectURL(s.url);
    document.removeEventListener('keydown',s.keydown);s.box.remove();document.body.style.overflow=s.oldOverflow;
    if(s.opener?.isConnected)s.opener.focus();
  }
  if(typeof window!=='undefined'){
    window.addEventListener('tasco:cloud-access',e=>{const next=e.detail?.user?.id||null;if(session&&next!==accountId)close();accountId=next;});
    window.addEventListener('pagehide',close);
  }
  return {normalizeResponse,normalizeSuggestions,matchVehicle,open,close};
});
