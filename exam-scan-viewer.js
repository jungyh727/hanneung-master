/* Full original exam scans rendered directly inside the PWA, not a separate answer sheet. */
const cachedPdfDocuments=new Map();
let activeRenderTask=null;
const escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad=n=>String(n).padStart(2,'0');

async function openSavedPdf(round,dbGetOne) {
 if(cachedPdfDocuments.has(round))return cachedPdfDocuments.get(round);
 const record=await dbGetOne('paperFiles',String(round));
 if(!record?.data)return null;
 const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
 pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
 const pdf=await pdfjs.getDocument({data:new Uint8Array(record.data)}).promise;
 cachedPdfDocuments.set(round,pdf);
 return pdf;
}

async function renderSavedPdf(round,pageNumber,dbGetOne,side) {
 const paper=await openSavedPdf(round,dbGetOne);
 const canvas=document.querySelector('#local-paper-canvas');
 const image=document.querySelector('#hosted-paper-image');
 const iframe=document.querySelector('#remote-paper-frame');
 if(!paper||!canvas)return false;
 if(activeRenderTask){try{activeRenderTask.cancel()}catch(_){}}
 if(image)image.hidden=true;
 if(iframe)iframe.hidden=true;
 canvas.hidden=false;
 const num=Math.max(1,Math.min(paper.numPages,pageNumber));
 const page=await paper.getPage(num);
 if(!canvas.isConnected)return false;
 const viewport=page.getViewport({scale:1.55});
 canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
 activeRenderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});
 try{await activeRenderTask.promise}catch(e){if(e.name!=='RenderingCancelledException')console.warn(e)}
 applyScanSide(side);
 const counter=document.querySelector('#paper-page-count');
 if(counter)counter.textContent=num+' / '+paper.numPages+'쪽';
 return true;
}

function applyScanSide(side) {
 const frame=document.getElementById('paper-scan-frame');
 if(!frame)return;
 frame.classList.toggle('scan-half',side!=='full');
 frame.classList.toggle('scan-full',side==='full');
 requestAnimationFrame(()=>{if(!frame.isConnected)return;frame.scrollLeft=side==='right'?(frame.scrollWidth-frame.clientWidth):0;frame.scrollTop=0});
}

export function showOfficialExamScan(c,{state,dbGetOne,dbPut,submit}) {
 const quiz=state.quiz;
 if(!quiz)return;
 const at=state.step, item=quiz.questions[at],round=quiz.officialRound;
 const entry=state.scanIndex?.scannedPages?.[String(round)];
 const totalPages=entry?.pages||12;
 const page=Math.max(1,Math.min(totalPages,state.paperPage||1));
 state.paperPage=page;
 const side=state.paperSide||'left',selection=state.answers[at];
 const imageSrc='./scans/'+round+'/page-'+pad(page)+'.webp';
 const roundLink=quiz.officialPage;
 const exam=state.officialExams.find(e=>e.round===round);
 const remote=exam?.pdfUrl?'https://docs.google.com/gview?embedded=1&url='+encodeURIComponent(exam.pdfUrl):'';
 const buttons=quiz.questions.map((p,i)=>'<button type="button" data-jump="'+i+'" class="sheet-number '+(state.answers[i]!==undefined?'answered ':'')+(at===i?'current':'')+'">'+p.num+'</button>').join('');
 const choices=['①','②','③','④','⑤'].map((value,i)=>'<button type="button" data-choice="'+i+'" class="answer-choice '+(selection===i?'selected':'')+'">'+value+'</button>').join('');
 c.innerHTML='<div class="between"><h2>제'+round+'회 심화 기출</h2><span class="pill">50문항 · 100점</span></div>'+
 '<section class="card"><div class="between"><h3>원본 문제지 스캔</h3><span class="small muted" id="paper-page-count">'+page+' / '+totalPages+'쪽</span></div>'+
 '<p class="small muted">문제 지문·사료·그림·5개 선지를 이미지에서 그대로 확인한 다음 아래 답을 선택하세요.</p>'+
 '<div class="paper-page-bar"><button id="paper-prev" type="button">◀ 이전 쪽</button><button id="paper-next" type="button">다음 쪽 ▶</button></div>'+
 '<div class="paper-side-bar"><button data-side="left" class="'+(side==='left'?'primary':'')+'">왼쪽 확대</button><button data-side="right" class="'+(side==='right'?'primary':'')+'">오른쪽 확대</button><button data-side="full" class="'+(side==='full'?'primary':'')+'">전체 보기</button></div>'+
 '<div id="paper-scan-frame" class="paper-scan-frame '+(side==='full'?'scan-full':'scan-half')+'">'+
 (entry?'<img id="hosted-paper-image" src="'+imageSrc+'" alt="제'+round+'회 기출문제 '+page+'쪽 스캔 이미지" loading="eager">':'')+
 '<canvas id="local-paper-canvas" hidden></canvas>'+
 (!entry&&remote?'<iframe id="remote-paper-frame" title="공식 기출 문제지 PDF 미리보기" src="'+escHtml(remote)+'" loading="lazy"></iframe>':'')+'</div>'+
 '<div class="scan-help" id="scan-help">'+(entry?'시험지 원본 스캔을 표시하고 있습니다.':'서버 스캔 준비 중입니다. 원본 PDF 미리보기가 보이지 않으면 아래에서 PDF 파일을 등록해 주세요.')+'</div>'+
 '<details class="paper-upload"><summary>스캔이 보이지 않을 때 · PDF 직접 불러오기</summary><label for="paper-file-input">제'+round+'회 심화 문제지 PDF</label><input id="paper-file-input" type="file" accept="application/pdf,.pdf">'+
 '<p class="small muted">한 번 등록하면 이 기기에 보관됩니다. 기기 간 자동 동기화는 제공되지 않습니다.</p><a href="'+escHtml(roundLink)+'" target="_blank" rel="noopener noreferrer">공식 문제지 다운로드 페이지</a></details></section>'+
 '<section class="card"><div class="between"><h3>문제 선택</h3><small id="answer-count">'+Object.keys(state.answers).length+' / 50개 답변</small></div><div class="sheet-grid">'+buttons+'</div></section>'+
 '<section class="card"><div class="between"><h3>제'+item.num+'번 답안</h3><span class="pill">'+item.points+'점</span></div>'+
 '<p class="small muted">위 스캔 이미지에서 '+item.num+'번을 읽고 정답을 고르세요.</p><div class="answer-choices">'+choices+'</div>'+
 '<div class="rows"><button type="button" id="exam-prev-q" '+(at===0?'disabled':'')+'>이전 문제</button><button type="button" id="exam-next-q" '+(at===49?'disabled':'')+'>다음 문제</button></div>'+
 '<button type="button" class="primary full" id="exam-finish" style="margin-top:14px">시험 종료 · 채점</button></section>';
 const frame=c.querySelector('#paper-scan-frame');
 const applyPage=n=>{state.paperPage=Math.max(1,Math.min(totalPages,n));showOfficialExamScan(c,{state,dbGetOne,dbPut,submit})};
 c.querySelector('#paper-prev').onclick=()=>applyPage(page-1);
 c.querySelector('#paper-next').onclick=()=>applyPage(page+1);
 c.querySelectorAll('[data-side]').forEach(b=>b.onclick=()=>{state.paperSide=b.dataset.side;c.querySelectorAll('[data-side]').forEach(x=>x.classList.toggle('primary',x===b));applyScanSide(state.paperSide)});
 c.querySelectorAll('[data-jump]').forEach(b=>b.onclick=()=>{state.step=Number(b.dataset.jump);showOfficialExamScan(c,{state,dbGetOne,dbPut,submit})});
 c.querySelectorAll('[data-choice]').forEach(b=>b.onclick=()=>{
  const index=Number(b.dataset.choice);
  state.answers[at]=index;item.scanPage=state.paperPage;item.scannedRound=round;
  c.querySelectorAll('[data-choice]').forEach(x=>x.classList.toggle('selected',x===b));
  const target=c.querySelector('[data-jump="'+at+'"]');if(target)target.classList.add('answered');
  c.querySelector('#answer-count').textContent=Object.keys(state.answers).length+' / 50개 답변';
 });
 c.querySelector('#exam-prev-q').onclick=()=>{state.step--;showOfficialExamScan(c,{state,dbGetOne,dbPut,submit})};
 c.querySelector('#exam-next-q').onclick=()=>{state.step++;showOfficialExamScan(c,{state,dbGetOne,dbPut,submit})};
 c.querySelector('#exam-finish').onclick=async()=>{
  const remain=50-Object.keys(state.answers).length;
  if(remain&&!confirm('미응답 '+remain+'문항이 있습니다. 채점하시겠습니까?'))return;
  await submit();
 };
 const input=c.querySelector('#paper-file-input');
 input.onchange=async()=>{const file=input.files?.[0];if(!file)return;
  if(file.size>55*1024*1024){alert('55MB 이하 PDF 파일을 선택하세요.');return}
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(String.fromCharCode(...bytes.slice(0,4))!=='%PDF'){alert('PDF 파일이 아닙니다.');return}
  await dbPut('paperFiles',{id:String(round),data:bytes,filename:file.name});
  cachedPdfDocuments.delete(round);
  state.localPapers[round]=true;
  const helper=c.querySelector('#scan-help');if(helper)helper.textContent='PDF가 이 기기에 저장되었습니다. 원본 문제지가 화면에 표시됩니다.';
  renderSavedPdf(round,page,dbGetOne,side).catch(e=>alert('PDF를 표시할 수 없습니다: '+e.message));
 };
 if(entry){const im=c.querySelector('#hosted-paper-image');if(im){im.onerror=()=>{const help=c.querySelector('#scan-help');if(help)help.textContent='스캔 이미지 불러오기 실패. PDF 파일을 직접 등록해 주세요.'};}}
 else{dbGetOne('paperFiles',String(round)).then(record=>{if(!record)return;state.localPapers[round]=true;renderSavedPdf(round,page,dbGetOne,side).catch(e=>console.warn('PDF display error',e))}).catch(()=>{})}
 applyScanSide(side);
}