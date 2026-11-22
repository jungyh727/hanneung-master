#!/usr/bin/env python3
"""Fetch official Korean History exam PDFs and render legible page scans for the PWA.
PDFs are used as the source; this repo only publishes rendered compressed pages.
"""
from pathlib import Path
import json, time, re
import requests
import fitz
from PIL import Image
import io

ROOT=Path(__file__).resolve().parent.parent
OUT=ROOT/"scans"
OUT.mkdir(exist_ok=True)
IDENTIFIERS={
  69:"B_202402171202232240",
  70:"B_202405251204104430",
  71:"B_202408101138402030",
  72:"B_202410201053136300",
  73:None,
  74:"B_202505241213575190",
  75:"B_202508091211578890",
  76:"B_202510180138534030",
  77:"B_202602071228075140",
  78:"B_202605230140467170",
  79:"B_202608090227540820",
  80:"B_202610171048317020"
}
FALLBACK={
  69:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=82033&idx=107655",
  70:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=83169&idx=109179",
  71:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=84077&idx=110340",
  72:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=85015&idx=111300",
  73:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=86423&idx=112854",
  74:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=87388&idx=114006",
  75:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=88155&idx=114993",
  76:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=88829&idx=115879",
  77:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=89821&idx=117061",
  78:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=90654&idx=117935",
  79:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=91367&idx=118544",
  80:"https://psat.lawschool.co.kr/nlawschool/board/Download.asp?boardName=pds&code=38&fileIdx=91913&idx=119108"
}
EXTRA_SOURCES={
  71:["https://blog.kakaocdn.net/dna/btboTu/btsI0Dt7UNG/AAAAAAAAAAAAAAAAAAAAAHW2WqG67p0UZQ_vIdqieo4Q2vE3MhpCwHAbbb8zVCuk/71%ED%9A%8C%20%ED%95%9C%EA%B5%AD%EC%82%AC_%EB%AC%B8%EC%A0%9C%EC%A7%80%28%EC%8B%AC%ED%99%94%29.pdf?allow_ip=&allow_referer=&attach=1&credential=yqXZFxpELC7KVnFOS48ylbz2pIh7yKj8&expires=1796050799&knm=tfile.pdf&signature=TybMrB2mIHHjXtYYswwxa80MCuw%3D"],
  73:["https://blog.kakaocdn.net/dna/kPNVK/btsMyIkTqkY/AAAAAAAAAAAAAAAAAAAAAO6WOrQYcNBWUkqex7B7zV1s2nO40E0RFQyhtFpy4NiB/73%ED%9A%8C%20%EC%8B%AC%ED%99%94%20%EB%AC%B8%EC%A0%9C%EC%A7%80.pdf?allow_ip=&allow_referer=&attach=1&credential=yqXZFxpELC7KVnFOS48ylbz2pIh7yKj8&expires=1796050799&knm=tfile.pdf&signature=PSqh60jJhfDseng%2BUiObBdTQPYA%3D"],
  80:["https://www.historyexam.go.kr/atchFile/FileDown.do?atch_file_id=B_202610171048317020"]
}
HEADERS={"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36","Accept":"application/pdf,application/octet-stream,*/*"}
session=requests.Session()
session.headers.update(HEADERS)
index={"format":"hanneung-scanned-paper-v1","scannedPages":{},"failures":{},"copyrightNotice":"원본: 국사편찬위원회 한국사능력검정시험 시험자료실. 사진·삽화의 권리는 각 원저작자에게 있을 수 있습니다."}
if (OUT/"index.json").exists():
    existing=json.loads((OUT/"index.json").read_text(encoding="utf-8"))
    index["scannedPages"].update(existing.get("scannedPages",{}))
for round_num,ident in IDENTIFIERS.items():
    if str(round_num) in index["scannedPages"] and (OUT/str(round_num)/"page-01.webp").exists():
        print("SKIP previously built",round_num,flush=True)
        continue
    urls=[]
    if ident: urls.append("https://www.historyexam.go.kr/atchFile/FileDown.do?atch_file_id="+ident)
    if round_num in FALLBACK: urls.append(FALLBACK[round_num])
    if round_num in EXTRA_SOURCES: urls.extend(EXTRA_SOURCES[round_num])
    raw=None
    for url in urls:
        try:
            response=session.get(url,timeout=35)
            print(round_num,response.status_code,len(response.content),response.headers.get("Content-Type"),flush=True)
            response.raise_for_status()
            if not response.content.startswith(b"%PDF"):
                raise ValueError("Response is not a PDF")
            raw=response.content
            break
        except Exception as ex:
            print(f"{round_num} source unavailable: {ex}",flush=True)
            time.sleep(1)
    if raw is None:
        index["failures"][str(round_num)]="공식 원본을 내려받지 못했습니다."
        continue
    try:
        document=fitz.open(stream=raw,filetype="pdf")
        if len(document)<10 or len(document)>30:
            raise ValueError(f"Unexpected PDF page count: {len(document)}")
        # Identify page and column for each numbered item from the source layout.
        # If the PDF is image-only, no inferred mapping is fabricated; manual page selection remains available.
        question_positions={}
        for pi,page in enumerate(document):
            for block in page.get_text("dict").get("blocks",[]):
                for line in block.get("lines",[]):
                    for span in line.get("spans",[]):
                        label=span["text"].strip()
                        m=re.match(r"^(\d{1,2})\.(?:\s|$)",label)
                        if not m:continue
                        number=int(m.group(1))
                        x,y=span["bbox"][:2]
                        if 1<=number<=50 and ((20<x<85) or (350<x<430)) and 30<y<page.rect.height-50:
                            question_positions[str(number)]={"page":pi+1,"side":"left" if x<page.rect.width/2 else "right"}
        folder=OUT/str(round_num)
        folder.mkdir(exist_ok=True)
        for old in folder.glob("page-*.webp"):old.unlink()
        for pi,page in enumerate(document):
            pix=page.get_pixmap(matrix=fitz.Matrix(1.55,1.55),colorspace=fitz.csRGB,alpha=False)
            image=Image.frombytes("RGB",[pix.width,pix.height],pix.samples)
            target=folder/f"page-{pi+1:02d}.webp"
            image.save(target,format="WEBP",quality=75,method=5)
        index["scannedPages"][str(round_num)]={"pages":len(document),"template":f"scans/{round_num}/page-{{page}}.webp","source":url,"questionPositions":question_positions,"locatedQuestions":len(question_positions)}
        print("SCANNED",round_num,len(document),"pages",flush=True)
    except Exception as ex:
        index["failures"][str(round_num)]=str(ex)
        print("SCAN ERROR",round_num,ex,flush=True)
(OUT/"index.json").write_text(json.dumps(index,ensure_ascii=False,indent=2),encoding="utf-8")
print("COMPLETE",list(index["scannedPages"]), "FAILED",list(index["failures"]),flush=True)
if not index["scannedPages"]:
    raise SystemExit("No source PDF could be downloaded: page scans not uploaded")
